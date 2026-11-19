import { Effect } from "effect";

export class TimeoutError extends Error {}

export function withTimeout<A, E, R>(
  work: Effect.Effect<A, E, R>,
  timeoutMs: number,
  message: string,
): Effect.Effect<A, E | TimeoutError, R> {
  return work.pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.fail(new TimeoutError(message)),
    }),
  );
}
