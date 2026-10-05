import { Effect, Result, Schema } from "effect";

/** Keeps archive failures typed until the native caller boundary. */
export class ArchiveOperationError extends Schema.TaggedError<ArchiveOperationError>()("ArchiveOperationError", {
  cause: Schema.Defect(),
}) {}

export function archiveFailure(cause: unknown): ArchiveOperationError {
  return cause instanceof ArchiveOperationError ? cause : new ArchiveOperationError({ cause });
}
export function archiveCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, ArchiveOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: archiveFailure });
}
export const archiveSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: archiveFailure });

/** Lets a native catch keep loop control and inspect the original operational error. */
export function archiveResult<A>(result: Result.Result<A, ArchiveOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
