import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class ProviderRuntimeFailure extends Schema.TaggedError<ProviderRuntimeFailure>()("ProviderRuntimeFailure", {
  cause: Schema.Defect(),
}) {}

export const {
  io: runtimeIO,
  sync: runtimeSync,
  rewrap: toProviderRuntimeFailure,
} = causeHelpers(ProviderRuntimeFailure);

export async function runRuntime<A>(operation: Effect.Effect<A, ProviderRuntimeFailure>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
