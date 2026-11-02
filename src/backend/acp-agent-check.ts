import { Deferred, Effect } from "effect";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
} from "./provider-client-effects";
// "Check agent": one trial start of a custom agent, before the user saves it.
//
// `initialize` is sent first. When the caller asks for models, one `session/new` follows, with no
// MCP servers, to read the models that the session lists; the agent saves nothing for OpenBot to
// keep, and a failure there gives no models but does not fail the check. The process starts in an
// empty temporary folder, in a process group of its own on POSIX, and the whole group is stopped
// when the check ends, however it ends.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ClientSideConnection, type InitializeResponse, ndJsonStream } from "@agentclientprotocol/sdk";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { CUSTOM_AGENT_LIMITS, type CustomAgentCheckResult } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { OPENBOT_ACP_CLIENT_CAPABILITIES, OPENBOT_ACP_CLIENT_INFO } from "./acp-client";
import { type AcpModel, modelsFromSessionSetup } from "./acp-configuration";
import { cliSpawnTarget } from "./cli";
import { stopWindowsProcessTree } from "./windows-process-tree";
import { TimeoutError } from "./with-timeout";

const AGENT_CHECK_TIMEOUT_MS = 20_000;
/** How long the model list may add to a check that has already passed. */
const MODEL_LIST_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;
const DETAIL_LIMIT = 300;
const OPENBOT_ACP_PROTOCOL_VERSION = 1;

export interface AgentCheckTarget {
  /** The resolved file, from `resolveAgentCommand`. */
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  /**
   * The `PATH` the agent starts with, from `agentLaunchPath`. Apart from `env`, because it is not a
   * secret to mask. A `PATH` in `env`, which the user saved on the agent, wins over it.
   */
  path?: string | null;
  timeoutMs?: number;
  /** Opens one session to read the models. An install check leaves it out: it needs only an answer. */
  listModels?: boolean;
}

/**
 * Starts the agent, asks what it is, and stops it. Rejects with a message the user can act on; the
 * agent's last stderr line is added only after `redactText` and after the agent's own environment
 * values are masked, because an agent can print the key it was given.
 */
export const checkAcpAgent = Effect.fn("AcpAgent.check")((target: AgentCheckTarget) =>
  Effect.acquireUseRelease(
    providerCall(() => mkdtemp(join(tmpdir(), "openbot-agent-check-"))),
    (folder) =>
      Effect.gen(function* () {
        const secrets = Object.values(target.env).filter((value) => value.length >= 4);
        const redact = (text: string) => maskValues(redactText(text), secrets);
        const spawnTarget = cliSpawnTarget(target.executable, target.args);
        let child: ChildProcessWithoutNullStreams | null = null;
        let lastStderr: string | null = null;
        return yield* Effect.gen(function* () {
          child = yield* providerSync(() =>
            spawn(spawnTarget.command, spawnTarget.args, {
              cwd: folder,
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, ...(target.path ? { PATH: target.path } : {}), ...target.env },
              detached: process.platform !== "win32",
              windowsVerbatimArguments: spawnTarget.windowsVerbatimArguments,
              windowsHide: true,
            }),
          );
          const started = child;
          started.stderr.on("data", (chunk: Buffer) => {
            const lines = chunk.toString("utf8").split(/\r?\n/u).filter(Boolean);
            const last = lines.at(-1);
            if (last) lastStderr = last;
          });
          const ended = Deferred.makeUnsafe<never, ProviderClientOperationError>();
          started.once("error", () =>
            Deferred.doneUnsafe(ended, Effect.fail(providerFailure(new CheckEnd("stopped")))),
          );
          started.once("close", () =>
            Deferred.doneUnsafe(ended, Effect.fail(providerFailure(new CheckEnd("stopped")))),
          );
          const connection = yield* providerSync(
            () =>
              new ClientSideConnection(
                () => ({
                  requestPermission: () => ({ outcome: { outcome: "cancelled" } }),
                  sessionUpdate: () => undefined,
                }),
                ndJsonStream(...processStreams(started)),
              ),
          );
          const initialization = yield* providerCall(() =>
            connection.initialize({
              protocolVersion: OPENBOT_ACP_PROTOCOL_VERSION,
              clientCapabilities: OPENBOT_ACP_CLIENT_CAPABILITIES,
              clientInfo: OPENBOT_ACP_CLIENT_INFO,
            }),
          ).pipe(
            Effect.raceFirst(Deferred.await(ended)),
            Effect.timeoutOrElse({
              duration: target.timeoutMs ?? AGENT_CHECK_TIMEOUT_MS,
              orElse: () =>
                Effect.fail(providerFailure(new TimeoutError(sourceText("error.provider.customAgentCheckTimedOut")))),
            }),
          );
          if (initialization.protocolVersion !== OPENBOT_ACP_PROTOCOL_VERSION) {
            return yield* providerFailure(
              new CheckFailure(
                sourceText("error.provider.customAgentProtocolVersion", {
                  version: String(initialization.protocolVersion),
                }),
              ),
            );
          }
          const models = target.listModels
            ? yield* providerCall(() => connection.newSession({ cwd: folder, mcpServers: [] })).pipe(
                Effect.raceFirst(Deferred.await(ended)),
                Effect.timeout(MODEL_LIST_TIMEOUT_MS),
                Effect.map((session) => modelNames(modelsFromSessionSetup(session))),
                // An agent that lists its models only after sign-in still passed the check.
                Effect.orElseSucceed(() => []),
              )
            : [];
          return checkResult(initialization, target.executable, models);
        }).pipe(
          Effect.mapError((error) => providerFailure(checkError(error.cause, lastStderr, redact))),
          Effect.ensuring(Effect.suspend(() => (child ? stopGroup(child) : Effect.void)).pipe(Effect.orDie)),
        );
      }),
    (folder) => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie),
  ),
);

/** The process ended before it answered. */
class CheckEnd extends Error {}

/** A reason whose message is already what the user reads. */
class CheckFailure extends Error {}

/**
 * The one error a check rejects with. An error from the SDK or the process is not passed on as it
 * is: its text can quote what the agent sent, so only the agent's redacted stderr line is added.
 */
function checkError(error: unknown, lastStderr: string | null, redact: (text: string) => string): Error {
  if (error instanceof CheckFailure || error instanceof TimeoutError) return new Error(error.message);
  const detail = lastStderr ? ` ${redact(lastStderr).slice(0, DETAIL_LIMIT)}` : "";
  const key =
    error instanceof CheckEnd ? "error.provider.customAgentCheckStopped" : "error.provider.customAgentCheckFailed";
  return new Error(`${sourceText(key)}${detail}`);
}

function checkResult(initialization: InitializeResponse, executable: string, models: string[]): CustomAgentCheckResult {
  const info = initialization.agentInfo;
  const agentName = (info?.title || info?.name || basename(executable)).slice(0, INPUT_LIMITS.agentName);
  const version = info?.version ? info.version.slice(0, 160) : null;
  return {
    agentName,
    version,
    protocolVersion: initialization.protocolVersion,
    capabilities: capabilityNames(initialization.agentCapabilities).slice(0, CUSTOM_AGENT_LIMITS.capabilities),
    models,
  };
}

/** One name per model, in the agent's order, within the IPC limits. */
function modelNames(models: readonly AcpModel[]): string[] {
  const names = new Set<string>();
  for (const model of models) {
    const name = (model.name.trim() || model.id).slice(0, INPUT_LIMITS.modelName);
    if (name) names.add(name);
    if (names.size >= CUSTOM_AGENT_LIMITS.checkModels) break;
  }
  return [...names];
}

/**
 * The capability names an agent reports, as flat tokens: `loadSession`, the prompt content kinds
 * (`image`, `audio`, `embeddedContext`), `mcp:http`, and `session:close`. What a newer agent adds
 * under these groups shows by its own name.
 */
function capabilityNames(capabilities: InitializeResponse["agentCapabilities"]): string[] {
  if (!capabilities) return [];
  const names: string[] = [];
  if (capabilities.loadSession === true) names.push("loadSession");
  const groups: ReadonlyArray<readonly [string, unknown]> = [
    ["", capabilities.promptCapabilities],
    ["mcp:", capabilities.mcpCapabilities],
    ["session:", capabilities.sessionCapabilities],
  ];
  for (const [prefix, group] of groups) {
    if (!isDynamicRecord(group)) continue;
    for (const [key, value] of Object.entries(group)) {
      if (key.startsWith("_") || value === false || value === null || value === undefined) continue;
      const name = `${prefix}${key}`;
      if (name.length <= INPUT_LIMITS.identifier) names.push(name);
    }
  }
  return names;
}

function maskValues(text: string, values: readonly string[]): string {
  let result = text;
  for (const value of values) result = result.split(value).join("[redacted]");
  return result;
}

/**
 * Web streams over the child's pipes, made here rather than with `Writable.toWeb`, whose Node types
 * do not match the global stream types that the SDK takes.
 */
function processStreams(
  child: ChildProcessWithoutNullStreams,
): [WritableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  const output = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
      }),
    close: () => {
      child.stdin.end();
    },
  });
  const input = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let open = true;
      child.stdout.on("data", (chunk: Buffer) => {
        if (open) controller.enqueue(new Uint8Array(chunk));
      });
      child.stdout.once("end", () => {
        if (!open) return;
        open = false;
        controller.close();
      });
      child.stdout.once("error", (error) => {
        if (!open) return;
        open = false;
        controller.error(error);
      });
    },
  });
  // A write to an agent that has exited fails on the pipe; the check reports the exit instead.
  child.stdin.on("error", () => undefined);
  return [output, input];
}

/** Stops the process group, and waits for the process to exit. SIGKILL after a short wait. */
const stopGroup = Effect.fn("AcpAgent.stopGroup")(function* (
  child: ChildProcessWithoutNullStreams,
): Effect.fn.Return<void, ProviderClientOperationError> {
  if (process.platform === "win32") {
    child.stdin.destroy();
    return yield* stopWindowsProcessTree(child).pipe(Effect.mapError((failure) => providerFailure(failure.cause)));
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      // The group has already exited.
    }
  };
  child.stdin.destroy();
  if (child.exitCode !== null || child.signalCode !== null) {
    // The leader is gone; members of its group can still run.
    signal("SIGKILL");
    return;
  }
  yield* Effect.callback<void>((resume) => {
    const force = setTimeout(() => signal("SIGKILL"), STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(force);
      signal("SIGKILL");
      resume(Effect.void);
    });
    signal("SIGTERM");
    return Effect.sync(() => clearTimeout(force));
  });
});
