import { Effect, Result, Schema } from "effect";

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

export function archiveResult<A>(result: Result.Result<A, ArchiveOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
