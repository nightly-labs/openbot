import { Effect, Schema } from "effect";

export class ProviderRuntimeFailure extends Schema.TaggedError<ProviderRuntimeFailure>()("ProviderRuntimeFailure", {
  cause: Schema.Defect(),
}) {}

export function runtimeIO<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ProviderRuntimeFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new ProviderRuntimeFailure({ cause }) });
}

export function runtimeSync<A>(operation: () => A): Effect.Effect<A, ProviderRuntimeFailure> {
  return Effect.try({ try: operation, catch: (cause) => new ProviderRuntimeFailure({ cause }) });
}
