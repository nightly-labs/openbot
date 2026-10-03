import { Effect, Result } from "effect";
import { ChannelOperationError } from "./channel-effects";
import { StoredStateFailure } from "./stored-state-effects";

/** Executes one test operation and exposes the existing public failure. */
export async function runChannel<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const failure = result.failure;
  throw failure instanceof ChannelOperationError || failure instanceof StoredStateFailure ? failure.cause : failure;
}
