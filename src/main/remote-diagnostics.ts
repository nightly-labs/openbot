import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { redactText } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import { desktopCall, desktopFailure, type RemoteDesktopOperationError } from "./remote-desktop-effects";

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LINE_CHARACTERS = 8_000;

/** The appends for each file run one at a time, so a rotation never races a write. */
const queues = new Map<string, Deferred.Deferred<void>>();

export const appendRemoteDiagnosticLog = Effect.fn("RemoteDesktop.appendDiagnosticLog")(function* (
  directory: string,
  name: string,
  message: string | Uint8Array,
) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
  const path = join(directory, `${safeName}.log`);
  const clean = Buffer.from(message).toString("utf8").split("\n").map(redactDiagnosticLine).join("\n");
  const previous = queues.get(path);
  const pending = Deferred.makeUnsafe<void>();
  queues.set(path, pending);
  yield* Effect.gen(function* () {
    if (previous) yield* Deferred.await(previous);
    if (clean) yield* writeDiagnosticEffect(directory, path, clean).pipe(Effect.ignore);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (queues.get(path) === pending) queues.delete(path);
        yield* Deferred.succeed(pending, undefined);
      }),
    ),
  );
}, Effect.uninterruptible);

// The shared rules need `=` or `:` after a credential name. Sunshine and Moonlight also print
// `token <value>`, which this log redacted before it used them.
function redactDiagnosticLine(line: string): string {
  return redactText(line).replace(/token[=: ]+[A-Za-z0-9._-]{8,}/giu, "[redacted]");
}

/**
 * Hands a process stream's output on in whole lines, so a secret that arrives split across two
 * chunks is redacted as one value. Each stream keeps its own carry-over and decoder: stdout and
 * stderr interleave, and one shared between them would join a line neither printed. The last line
 * is handed on when the stream ends, newline or not. A line longer than the limit is cut there and
 * the rest of it dropped, because a piece written on its own could hold a secret no rule matches.
 */
export function forwardDiagnosticLines(stream: Readable | null | undefined, forward: (text: string) => void): void {
  const decoder = new StringDecoder("utf8");
  let partial = "";
  let dropping = false;
  stream?.on("data", (chunk: Buffer | string) => {
    const lines = (partial + (typeof chunk === "string" ? chunk : decoder.write(chunk))).split("\n");
    partial = lines.pop() ?? "";
    const complete: string[] = [];
    for (const line of lines) {
      if (!dropping) complete.push(cutLine(line));
      dropping = false;
    }
    if (dropping) partial = "";
    else if (partial.length > MAX_LINE_CHARACTERS) {
      complete.push(cutLine(partial));
      partial = "";
      dropping = true;
    }
    if (complete.length) forward(`${complete.join("\n")}\n`);
  });
  stream?.on("end", () => {
    const rest = partial + decoder.end();
    if (rest && !dropping) forward(`${rest}\n`);
    partial = "";
  });
}

/**
 * Cuts a line to the limit, and drops the word the limit falls in: a secret or a header name cut in
 * two no longer matches the rule that would redact it, and its first part is most of the value.
 */
function cutLine(line: string): string {
  return line.length > MAX_LINE_CHARACTERS ? line.slice(0, MAX_LINE_CHARACTERS).replace(/\S+$/u, "") : line;
}

const writeDiagnosticEffect = Effect.fn("RemoteDesktop.writeDiagnostic")(function* (
  directory: string,
  path: string,
  clean: string,
) {
  yield* desktopCall(() => mkdir(directory, { recursive: true }));
  yield* Effect.gen(function* () {
    if ((yield* desktopCall(() => stat(path))).size >= MAX_LOG_BYTES)
      yield* desktopCall(() => rename(path, `${path}.1`));
  }).pipe(Effect.catch(() => Effect.void));
  yield* desktopCall(() => appendFile(path, clean, { encoding: "utf8", mode: 0o600 }));
});

interface ManagedChildProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: string, listener: (...args: unknown[]) => unknown): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

export const stopRemoteProcess = Effect.fn("RemoteDesktop.stopProcess")(function* (
  child: ManagedChildProcess,
  graceMs = 2_000,
) {
  // A child that a signal ended has already emitted its exit event.
  if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
  yield* Effect.callback<void, RemoteDesktopOperationError>((resume) => {
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(forceTimer);
      resume(Effect.void);
    };
    const forceTimer = setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill("SIGKILL");
        finish();
      } catch (cause) {
        complete = true;
        resume(Effect.fail(desktopFailure(cause)));
      }
    }, graceMs);
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch (cause) {
      complete = true;
      resume(Effect.fail(desktopFailure(cause)));
    }
    return Effect.sync(() => {
      clearTimeout(forceTimer);
      child.removeListener?.("exit", finish);
      if (!complete && child.exitCode === null) child.kill("SIGKILL");
    });
  });
});
