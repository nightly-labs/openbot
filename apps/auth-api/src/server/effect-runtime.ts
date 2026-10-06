import { Effect, Result } from "effect";

/** Keeps typed domain errors intact for the existing HTTP error mappers. */
export async function runApiEffect<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

/** Runs one route handler's Effect and maps any failure or thrown error to its response. */
export function runApiResponse<E>(
  operation: Effect.Effect<Response, E>,
  errorResponse: (error: unknown) => Response,
): Promise<Response> {
  return runApiEffect(operation).catch(errorResponse);
}
