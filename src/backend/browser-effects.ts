import { Effect, Schema } from "effect";

/** Keeps the original browser failure for the existing IPC and tool error boundary. */
export class BrowserOperationError extends Schema.TaggedError<BrowserOperationError>()("BrowserOperationError", {
  cause: Schema.Defect(),
}) {}

export function browserFailure(cause: unknown): BrowserOperationError {
  return cause instanceof BrowserOperationError ? cause : new BrowserOperationError({ cause });
}

export const browserCall = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: browserFailure });
export const browserSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: browserFailure });

/** The reasons that stop a secure fill. Each is fixed text, with no page text and no secret (#10536). */
const SECURE_INPUT_FAILURES = [
  "Authentication page changed.",
  "Authentication target changed.",
  "Authentication submit button is not ready.",
  "Authentication submission timed out.",
  "Authentication page reload timed out.",
] as const;

/**
 * The fixed reason of a failed secure fill, for the log and the agent. A page error can hold page text,
 * so only a known reason is kept; any other failure gives undefined.
 */
export function secureInputFailure(error: BrowserOperationError): string | undefined {
  const message = error.cause instanceof Error ? error.cause.message : "";
  return SECURE_INPUT_FAILURES.find((reason) => message.includes(reason));
}
