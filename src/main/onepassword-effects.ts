import { Effect, Schema } from "effect";

/** A failure of the 1Password connection. The original error stays as the cause for the native boundary. */
export class OnePasswordOperationError extends Schema.TaggedError<OnePasswordOperationError>()(
  "OnePasswordOperationError",
  { cause: Schema.Defect() },
) {}

export const onePasswordCall = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new OnePasswordOperationError({ cause }) });
export const onePasswordDecode = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: (cause) => new OnePasswordOperationError({ cause }) });
