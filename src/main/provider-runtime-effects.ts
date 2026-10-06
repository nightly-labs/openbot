import { Effect, Result, Schema } from "effect";

export class ProviderRuntimeFailure extends Schema.TaggedError<ProviderRuntimeFailure>()("ProviderRuntimeFailure", {
  cause: Schema.Defect(),
}) {}

export function runtimeIO<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ProviderRuntimeFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new ProviderRuntimeFailure({ cause }) });
}

export function runtimeSync<A>(operation: () => A): Effect.Effect<A, ProviderRuntimeFailure> {
  return Effect.try({ try: operation, catch: (cause) => new ProviderRuntimeFailure({ cause }) });
}

export async function runRuntime<A>(operation: Effect.Effect<A, ProviderRuntimeFailure>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
