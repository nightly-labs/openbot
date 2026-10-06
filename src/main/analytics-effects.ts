import { Effect, Schema } from "effect";

export class AnalyticsOperationFailure extends Schema.TaggedError<AnalyticsOperationFailure>()(
  "AnalyticsOperationFailure",
  {
    cause: Schema.Defect(),
  },
) {}

export function analyticsIO<A>(operation: () => Promise<A>): Effect.Effect<A, AnalyticsOperationFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new AnalyticsOperationFailure({ cause }) });
}

export function analyticsSync<A>(operation: () => A): Effect.Effect<A, AnalyticsOperationFailure> {
  return Effect.try({ try: operation, catch: (cause) => new AnalyticsOperationFailure({ cause }) });
}
