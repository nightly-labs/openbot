import { Effect, Result } from "effect";

export async function runTeamEffect<A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation), { signal });
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
