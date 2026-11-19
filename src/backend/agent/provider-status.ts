import type { ChildProcess } from "node:child_process";
import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { type AgentProvider, RequestTimeoutError } from "../agent-client";
import { CodexCliError } from "../cli";
import { ProviderSignInError } from "../provider-client-effects";
import { stopProcessTree } from "../windows-process-tree";
import { TimeoutError } from "../with-timeout";

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
  const message = redactText(error instanceof Error ? error.message : String(error));
  if (error instanceof ProviderSignInError) return { state: "sign-in-required", version: version ?? null, message };
  if (error instanceof CodexCliError) {
    if (error.code === "timeout") return { state: "error", version: version ?? null, message };
    if (error.code === "outdated") {
      return { state: "outdated", version: version ?? null, message };
    }
    if (error.code === "missing" && provider !== "codex" && provider !== "claude") {
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
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode, child.signalCode);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.gen(function* () {
          yield* stopProcessTree(child).pipe(Effect.ignore);
          return yield* new ProviderProcessFailed({ cause: new Error(`${description} timed out.`) });
        }),
    }),
  );
});

const SIGN_IN_OUTPUT_LIMIT = 8 * 1024;
const SIGN_IN_OUTPUT_DRAIN_MS = 1_000;

export const waitForSignInProcess = Effect.fnUntraced(function* (
  child: ChildProcess,
  command: { readonly timeoutMs: number; readonly failureText?: ((output: string) => string | null) | undefined },
) {
  const { failureText } = command;
  if (!failureText) return yield* waitForSuccessfulProcess(child, command.timeoutMs);
  let output = "";
  let closed = false;
  const read = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-SIGN_IN_OUTPUT_LIMIT);
  };
  const close = () => {
    closed = true;
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  child.once("close", close);
  const outputEnded = Effect.callback<void>((resume) => {
    if (closed) return resume(Effect.void);
    const ended = () => resume(Effect.void);
    child.once("close", ended);
    return Effect.sync(() => child.off("close", ended));
  }).pipe(Effect.timeoutOption(SIGN_IN_OUTPUT_DRAIN_MS));
  return yield* waitForSuccessfulProcess(child, command.timeoutMs).pipe(
    Effect.catch((failure) =>
      Effect.gen(function* () {
        yield* outputEnded;
        const message = failureText(output);
        return yield* new ProviderProcessFailed({
          cause: message ? new ProviderSignInError({ message }) : failure.cause,
        });
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        child.stdout?.off("data", read);
        child.stderr?.off("data", read);
        child.off("close", close);
        output = "";
      }),
    ),
  );
});

export interface SavedSignInWatch {
  readonly before: string | null;
  readonly read: Effect.Effect<string | null>;
}

export const watchSavedSignIn = (
  read: Effect.Effect<string | null> | undefined,
): Effect.Effect<SavedSignInWatch | undefined> =>
  read ? Effect.map(read, (before) => ({ before, read })) : Effect.succeed(undefined);

export const orNewSavedSignIn = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  watch: SavedSignInWatch | undefined,
  value: A,
): Effect.Effect<A, E, R> =>
  watch
    ? effect.pipe(
        Effect.catch((failure) =>
          watch.read.pipe(
            Effect.flatMap((after) =>
              after !== null && after !== watch.before ? Effect.succeed(value) : Effect.fail(failure),
            ),
          ),
        ),
      )
    : effect;
