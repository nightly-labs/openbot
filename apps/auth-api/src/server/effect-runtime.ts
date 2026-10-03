import { Effect, Result } from "effect";

/** Keeps typed domain errors intact for the existing HTTP error mappers. */
export async function runApiEffect<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
