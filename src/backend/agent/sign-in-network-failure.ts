import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ProviderSignInError } from "../provider-client-effects";

/** The end of a sign-in command's error output that OpenBot keeps. The cause is in the last lines. */
const OUTPUT_TAIL_CHARS = 4096;
/** How long a failed sign-in waits for the error output that comes after the command exits. */
const OUTPUT_DRAIN_MS = 1000;

/**
 * A request that did not reach the provider's service: no network, a blocked host, or a proxy that
 * does not answer. Rust CLIs (reqwest and hyper, such as Grok) and Node CLIs write these. A refused
 * account is an HTTP answer and has none of them. Grok 1.0.77 offline writes
 * `error sending request for url (https://auth.x.ai/...): client error (Connect): ... dns error` (#7377).
 */
const NETWORK_FAILURE =
  /\berror sending request for url\b|\bdns error\b|\btcp connect error\b|\bgetaddrinfo\b|\bfetch failed\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/u;

/**
 * Keeps the end of what `stream` writes, to find why a sign-in failed. The output can hold a sign-in
 * link or a code, so it is only matched: nothing logs it, and no error quotes it.
 */
export function readOutputTail(stream: Readable | null | undefined): () => string {
  let tail = "";
  stream?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_CHARS);
  });
  return () => tail;
}

/** True when the output of a failed sign-in says that the provider's service could not be reached. */
function isNetworkFailureOutput(output: string): boolean {
  return NETWORK_FAILURE.test(output);
}

/** The sign-in failure that the user reads when the provider's service could not be reached. */
function signInNetworkError(): ProviderSignInError {
  return new ProviderSignInError({ message: sourceText("error.provider.signInNetwork") });
}

/**
 * Waits until the command's output closes, so its last line is read. The output can close after the
 * exit, and a page that the command opened can keep it open, so the wait has a limit.
 */
function outputClosed(child: ChildProcess): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if ([child.stdout, child.stderr].every((stream) => stream === null || stream.destroyed)) {
      return resume(Effect.void);
    }
    const closed = () => resume(Effect.void);
    child.once("close", closed);
    return Effect.sync(() => child.off("close", closed));
  }).pipe(Effect.timeoutOption(OUTPUT_DRAIN_MS), Effect.asVoid);
}

/**
 * The network failure of a sign-in command that failed, or null when its output gives another cause.
 * Only a command that ended by itself is read: a sign-in that OpenBot stopped, such as at its deadline,
 * keeps its own message, also when the command logged a network error that it then recovered from.
 */
export const signInNetworkFailure = Effect.fnUntraced(function* (child: ChildProcess, output: () => string) {
  yield* outputClosed(child);
  return child.exitCode !== null && isNetworkFailureOutput(output()) ? signInNetworkError() : null;
});
