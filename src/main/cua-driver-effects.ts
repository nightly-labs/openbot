import { Effect, Schema } from "effect";

/** Keep driver diagnostics inside the main-process boundary. */
export class CuaDriverFailure extends Schema.TaggedError<CuaDriverFailure>()("CuaDriverFailure", {
  cause: Schema.Defect(),
}) {}

export function cuaIO<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, CuaDriverFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new CuaDriverFailure({ cause }) });
}

export function cuaSync<A>(operation: () => A): Effect.Effect<A, CuaDriverFailure> {
  return Effect.try({ try: operation, catch: (cause) => new CuaDriverFailure({ cause }) });
}
