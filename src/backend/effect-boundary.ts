import { Effect, Result } from "effect";

/**
 * Runs an Effect at a Promise boundary and rejects with the original failure that the typed error
 * wraps. Defects and interruption still reject as they are.
 */
export async function runCauseEffect<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
