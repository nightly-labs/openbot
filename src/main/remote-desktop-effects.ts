import { Effect, Result, Schema } from "effect";

/** Preserves remote desktop failures at the existing Promise interfaces. */
export class RemoteDesktopOperationError extends Schema.TaggedError<RemoteDesktopOperationError>()(
  "RemoteDesktopOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export function desktopFailure(cause: unknown): RemoteDesktopOperationError {
  return cause instanceof RemoteDesktopOperationError ? cause : new RemoteDesktopOperationError({ cause });
}
export function desktopCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, RemoteDesktopOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: desktopFailure });
}
export const desktopSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: desktopFailure });

export async function runDesktopEffect<A>(operation: Effect.Effect<A, RemoteDesktopOperationError>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
