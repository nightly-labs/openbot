import { Effect, Schema } from "effect";

/** Expected failures from tool validation and injected storage or provider adapters. */
export class ToolOperationFailed extends Schema.TaggedError<ToolOperationFailed>()("ToolOperationFailed", {
  cause: Schema.Defect(),
}) {}

export function toolStep<A>(run: () => A): Effect.Effect<A, ToolOperationFailed> {
  return Effect.try({ try: run, catch: (cause) => new ToolOperationFailed({ cause }) });
}
