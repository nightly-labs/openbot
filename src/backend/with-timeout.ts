import { Effect } from "effect";

/** Distinguishes this deadline from a failure reported by the operation. */
export class TimeoutError extends Error {}

/** Bound one waiter. Use Fiber.join to wait without cancelling separately owned work. */
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
