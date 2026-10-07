import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";
import { StoredStateFailure } from "./stored-state-effects";

/** Preserves channel errors at the existing command and provider boundaries. */
export class ChannelOperationError extends Schema.TaggedError<ChannelOperationError>()("ChannelOperationError", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toChannelOperationError } = causeHelpers(ChannelOperationError);

export function channelFailure(cause: unknown): ChannelOperationError {
  return cause instanceof ChannelOperationError
    ? cause
    : new ChannelOperationError({ cause: cause instanceof StoredStateFailure ? cause.cause : cause });
}
export const channelSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: channelFailure });

/** Lets a native catch keep loop control and inspect the original operational error. */
export function channelResult<A>(result: Result.Result<A, ChannelOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
