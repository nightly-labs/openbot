import { Cause, Effect, Result } from "effect";

/** A typed error class whose only field is the private original failure. */
type CauseError<E> = new (fields: { readonly cause: unknown }) => E;

/**
 * Builds the adapters that put an expected failure into one typed error. `io` and `sync` wrap a
 * thrown or rejected value; `rewrap` moves the original cause of another typed error into this one.
 */
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

/**
 * Runs an Effect at a Promise boundary and rejects with the original failure that the typed error
 * wraps. Defects and interruption still reject as they are.
 */
export async function runCauseEffect<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

/**
 * Gives `report` the private original failure in a cause: the value that a typed error wraps, or the
 * defect as it is. Use it where a handler must also catch defects, so one bad record cannot stop a
 * loop or a cleanup.
 */
export function reportOriginalFailure(
  cause: Cause.Cause<{ readonly cause: unknown }>,
  report: (failure: unknown) => void,
): Effect.Effect<void> {
  return Effect.sync(() => {
    const failure = Cause.findError(cause);
    report(Result.isSuccess(failure) ? failure.success.cause : Cause.squash(cause));
  });
}
