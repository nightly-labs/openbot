import { Effect, Result, Schema } from "effect";

/** Preserves provider SDK failures at the existing Promise interfaces. */
export class ProviderClientOperationError extends Schema.TaggedError<ProviderClientOperationError>()(
  "ProviderClientOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export function providerFailure(cause: unknown): ProviderClientOperationError {
  return cause instanceof ProviderClientOperationError ? cause : new ProviderClientOperationError({ cause });
}
export function providerCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, ProviderClientOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: providerFailure });
}
export const providerSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: providerFailure });

export async function runProviderClientEffect<A>(
  operation: Effect.Effect<A, ProviderClientOperationError>,
): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

/** Lets a native catch keep loop control and inspect the original operational error. */
export function providerResult<A>(result: Result.Result<A, ProviderClientOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
