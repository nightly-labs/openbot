import { Effect, Schema } from "effect";

export class BrowserOperationError extends Schema.TaggedError<BrowserOperationError>()("BrowserOperationError", {
  cause: Schema.Defect(),
}) {}

export function browserFailure(cause: unknown): BrowserOperationError {
  return cause instanceof BrowserOperationError ? cause : new BrowserOperationError({ cause });
}

export const browserCall = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: browserFailure });
export const browserSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: browserFailure });

const SECURE_INPUT_FAILURES = [
  "Authentication page changed.",
  "Authentication target changed.",
  "Authentication submit button is not ready.",
  "Authentication field did not keep the value.",
  "Authentication submission timed out.",
  "Authentication page reload timed out.",
] as const;

export function secureInputFailure(error: BrowserOperationError): string | undefined {
  const message = error.cause instanceof Error ? error.cause.message : "";
  return SECURE_INPUT_FAILURES.find((reason) => message.includes(reason));
}
