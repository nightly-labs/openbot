// "Check agent": one trial start of a custom agent, before the user saves it.
//
// Only `initialize` is sent. `session/new` is not: it can make an agent write in its folder, start
// MCP servers, or sign in. The process starts in an empty temporary folder, in a process group of
// its own on POSIX, and the whole group is stopped when the check ends, however it ends.

import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
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
import { cliSpawnTarget } from "./cli";
import { TimeoutError, withTimeout } from "./with-timeout";

const AGENT_CHECK_TIMEOUT_MS = 20_000;
const STOP_GRACE_MS = 2_000;
const DETAIL_LIMIT = 300;
const OPENBOT_ACP_PROTOCOL_VERSION = 1;

export interface AgentCheckTarget {
  /** The resolved file, from `resolveAgentCommand`. */
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

/**
 * Starts the agent, asks what it is, and stops it. Rejects with a message the user can act on; the
 * agent's last stderr line is added only after `redactText` and after the agent's own environment
 * values are masked, because an agent can print the key it was given.
 */
export async function checkAcpAgent(target: AgentCheckTarget): Promise<CustomAgentCheckResult> {
  const folder = await mkdtemp(join(tmpdir(), "openbot-agent-check-"));
  const secrets = Object.values(target.env).filter((value) => value.length >= 4);
  const redact = (text: string) => maskValues(redactText(text), secrets);
  const spawnTarget = cliSpawnTarget(target.executable, target.args);
  let child: ChildProcessWithoutNullStreams | null = null;
  let lastStderr: string | null = null;
  try {
    child = spawn(spawnTarget.command, spawnTarget.args, {
      cwd: folder,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...target.env },
      detached: process.platform !== "win32",
      windowsVerbatimArguments: spawnTarget.windowsVerbatimArguments,
      windowsHide: true,
    });
    const started = child;
    started.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split(/\r?\n/u).filter(Boolean);
      const last = lines.at(-1);
      if (last) lastStderr = last;
    });
    const ended = new Promise<never>((_resolve, reject) => {
      started.once("error", () => reject(new CheckEnd("stopped")));
      started.once("close", () => reject(new CheckEnd("stopped")));
    });
    const connection = new ClientSideConnection(
      () => ({
        requestPermission: () => ({ outcome: { outcome: "cancelled" } }),
        sessionUpdate: () => undefined,
      }),
      ndJsonStream(...processStreams(started)),
    );
    const initialization = await withTimeout(
      Promise.race([
        connection.initialize({
          protocolVersion: OPENBOT_ACP_PROTOCOL_VERSION,
          clientCapabilities: OPENBOT_ACP_CLIENT_CAPABILITIES,
          clientInfo: OPENBOT_ACP_CLIENT_INFO,
        }),
        ended,
      ]),
      target.timeoutMs ?? AGENT_CHECK_TIMEOUT_MS,
      sourceText("error.provider.customAgentCheckTimedOut"),
    );
    if (initialization.protocolVersion !== OPENBOT_ACP_PROTOCOL_VERSION) {
      throw new CheckFailure(
        sourceText("error.provider.customAgentProtocolVersion", { version: String(initialization.protocolVersion) }),
      );
    }
    return checkResult(initialization, target.executable);
  } catch (error) {
    throw checkError(error, lastStderr, redact);
  } finally {
    if (child) await stopGroup(child);
    await rm(folder, { recursive: true, force: true });
  }
}

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

function checkResult(initialization: InitializeResponse, executable: string): CustomAgentCheckResult {
  const info = initialization.agentInfo;
  const agentName = (info?.title || info?.name || basename(executable)).slice(0, INPUT_LIMITS.agentName);
  const version = info?.version ? info.version.slice(0, 160) : null;
  return {
    agentName,
    version,
    protocolVersion: initialization.protocolVersion,
    capabilities: capabilityNames(initialization.agentCapabilities).slice(0, CUSTOM_AGENT_LIMITS.capabilities),
  };
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
async function stopGroup(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === "win32") return stopWindowsTree(child);
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
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => signal("SIGKILL"), STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(force);
      signal("SIGKILL");
      resolve();
    });
    signal("SIGTERM");
  });
}

/**
 * Windows has no process group: a `.cmd` agent runs under `cmd.exe`, and a kill of the wrapper
 * leaves the agent running. `taskkill /T` stops the whole tree while the wrapper still holds it.
 */
async function stopWindowsTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.destroy();
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve) =>
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
  );
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await exited;
}
