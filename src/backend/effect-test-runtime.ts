import { Effect, Result } from "effect";

/** Execute at the test boundary and expose the original failure for existing assertions. */
export async function runTestEffect<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
