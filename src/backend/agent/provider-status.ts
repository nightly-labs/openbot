import type { ChildProcess } from "node:child_process";
import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { type AgentProvider, RequestTimeoutError } from "../agent-client";
import { CodexCliError } from "../cli";
import { stopProcessTree } from "../windows-process-tree";
import { TimeoutError } from "../with-timeout";

/** The CLI did not answer in time: its `--version`, or a request of its start, such as `initialize`. */
export function isProviderTimeout(error: unknown): boolean {
  return (
    (error instanceof CodexCliError && error.code === "timeout") ||
    error instanceof TimeoutError ||
    error instanceof RequestTimeoutError
  );
}

export function setProviderStatus(
  statuses: AgentProviderStatus[],
  provider: AgentProvider,
  patch: Omit<AgentProviderStatus, "id">,
): void {
  const index = statuses.findIndex((status) => status.id === provider);
  const status = { id: provider, ...patch };
  if (index === -1) statuses.push(status);
  else statuses[index] = status;
}

export function updateProviderStatus(
  statuses: AgentProviderStatus[] | undefined,
  provider: AgentProvider,
  patch: Omit<AgentProviderStatus, "id">,
): AgentProviderStatus[] {
  const next = structuredClone(statuses ?? []);
  setProviderStatus(next, provider, patch);
  return next;
}

export function providerFailureStatus(
  provider: AgentProvider,
  error: unknown,
  version: string | null | undefined,
): Omit<AgentProviderStatus, "id"> {
  // Redacted, because this message reaches the renderer and every log with it, and a provider CLI
  // quotes what it was given: an OpenCode failure can carry the API key or a header value of a
  // custom endpoint. The fixed strings below need no redaction, but the CLI's own text does.
  const message = redactText(error instanceof Error ? error.message : String(error));
  if (error instanceof CodexCliError) {
    // A CLI that did not answer in time is not broken, so the message must not ask for a reinstall.
    if (error.code === "timeout") return { state: "error", version: version ?? null, message };
    // An app update can require a newer CLI than the one in the runtime store.
    // Keep the version error so the user can update the provider in OpenBot.
    if (error.code === "outdated") {
      return { state: "outdated", version: version ?? null, message };
    }
    if (provider === "codex" || provider === "claude") {
      const label = provider === "codex" ? "ChatGPT" : "Claude";
      const bundledMessage =
        error.code === "missing"
          ? `OpenBot's included ${label} runtime is missing. Reinstall OpenBot.`
          : `OpenBot could not start its included ${label} runtime. Update or reinstall OpenBot.`;
      return { state: "error", version: version ?? null, message: bundledMessage };
    }
    if (error.code === "missing") {
      return { state: "not-installed", version: null, message };
    }
  }
  return { state: "error", version: version ?? null, message };
}

export class ProviderProcessFailed extends Schema.TaggedError<ProviderProcessFailed>()("ProviderProcessFailed", {
  cause: Schema.Defect(),
}) {}

export const waitForSuccessfulProcess = Effect.fnUntraced(function* (
  child: ChildProcess,
  timeoutMs: number,
  description = "Provider login",
) {
  return yield* Effect.callback<void, ProviderProcessFailed>((resume) => {
    let settled = false;
    const cleanup = () => {
      child.off("error", failed);
      child.off("exit", exited);
    };
    const finish = (effect: Effect.Effect<void, ProviderProcessFailed>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const failed = (cause: Error) => finish(Effect.fail(new ProviderProcessFailed({ cause })));
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 && signal === null) finish(Effect.void);
      else failed(new Error(`${description} stopped with ${signal ?? `code ${String(code)}`}.`));
    };
    child.once("error", failed);
    child.once("exit", exited);
    // The login child can exit before this Effect is scheduled.
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode, child.signalCode);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.gen(function* () {
          // A `.cmd` launcher runs under `cmd.exe`, and a kill of the wrapper leaves the CLI running.
          yield* stopProcessTree(child).pipe(Effect.ignore);
          return yield* new ProviderProcessFailed({ cause: new Error(`${description} timed out.`) });
        }),
    }),
  );
});
