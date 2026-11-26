import { Cause, Effect, Result } from "effect";

type CauseError<E> = new (fields: { readonly cause: unknown }) => E;

export function causeHelpers<E>(ErrorClass: CauseError<E>) {
  const fail = (cause: unknown) => new ErrorClass({ cause });
  return {
    io: <A>(operation: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, E> =>
      Effect.tryPromise({ try: operation, catch: fail }),
    sync: <A>(operation: () => A): Effect.Effect<A, E> => Effect.try({ try: operation, catch: fail }),
    rewrap: <A, R>(operation: Effect.Effect<A, { readonly cause: unknown }, R>): Effect.Effect<A, E, R> =>
      Effect.mapError(operation, (failure) => fail(failure.cause)),
  };
}

export async function runCauseEffect<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

export function reportOriginalFailure(
  cause: Cause.Cause<{ readonly cause: unknown }>,
  report: (failure: unknown) => void,
): Effect.Effect<void> {
  return Effect.sync(() => {
    const failure = Cause.findError(cause);
    report(Result.isSuccess(failure) ? failure.success.cause : Cause.squash(cause));
  });
}
