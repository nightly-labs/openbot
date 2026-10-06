import { Effect, Schema } from "effect";

/** Expected storage failures retain their cause for mapping at application boundaries. */
export class StoredStateFailure extends Schema.TaggedError<StoredStateFailure>()("StoredStateFailure", {
  cause: Schema.Defect(),
}) {}

export function storedIO<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, StoredStateFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new StoredStateFailure({ cause }) });
}

export function storedSync<A>(operation: () => A): Effect.Effect<A, StoredStateFailure> {
  return Effect.try({ try: operation, catch: (cause) => new StoredStateFailure({ cause }) });
}
