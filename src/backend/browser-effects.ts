import { Effect, Result, Schema } from "effect";

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

export async function runBrowserEffect<A>(operation: Effect.Effect<A, BrowserOperationError>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
