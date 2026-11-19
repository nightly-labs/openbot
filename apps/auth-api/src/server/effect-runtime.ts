import { Effect, Result } from "effect";

export async function runApiEffect<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

export function runApiResponse<E>(
  operation: Effect.Effect<Response, E>,
  errorResponse: (error: unknown) => Response,
): Promise<Response> {
  return runApiEffect(operation).catch(errorResponse);
}
