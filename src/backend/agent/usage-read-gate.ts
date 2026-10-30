import { Effect, Semaphore } from "effect";

/**
 * How long a reading answers every view before the provider is asked again. Each desktop window, web tab
 * and phone polls every five minutes, as t3code and CodexBar do; this is a little shorter, so each poll of
 * one view still gets a new reading, and more views do not ask more often.
 */
const USAGE_READ_INTERVAL_MS = 4 * 60_000;
/** The first wait after a failed read. It doubles with each failure that follows. */
const USAGE_RETRY_MS = 5 * 60_000;
/** The longest wait after failed reads. */
const USAGE_RETRY_MAX_MS = 60 * 60_000;

/**
 * Paces the usage reads of one sign-in. A usage endpoint, such as Claude's, allows few requests an hour for
 * each login and shares them with the provider's own CLI; a client that asks again during a rate limit
 * stays limited. So one read runs at a time, a reading answers for four minutes, and after a failed read,
 * such as HTTP 429, the next one waits 5 minutes, then 10, 20 and 40, up to an hour, as openusage waits.
 */
export class UsageReadGate {
  #nextReadAt = 0;
  /** When the last read that succeeded started. */
  #readAt = 0;
  #failures = 0;
  /** Counts the resets, so that a read that started before one does not set the next read time. */
  #generation = 0;
  readonly #lock = Semaphore.makeUnsafe(1);

  /**
   * Runs `read` when one is due, else answers `kept`. A request that comes during a read waits for it,
   * then takes `kept`. `stale` gets the start of the last read that succeeded, and lets a read go before
   * the interval ends, such as when a window of the reading reset after that read, but not during the
   * wait after a failure.
   */
  run<A, E, R>(options: {
    read: Effect.Effect<A, E, R>;
    kept: () => A;
    stale?: (readAt: number) => boolean;
  }): Effect.Effect<A, E, R> {
    return this.#lock.withPermit(
      Effect.suspend(() => {
        const due = Date.now() >= this.#nextReadAt || (this.#failures === 0 && options.stale?.(this.#readAt) === true);
        if (!due) return Effect.succeed(options.kept());
        const generation = this.#generation;
        const startedAt = Date.now();
        return options.read.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (generation === this.#generation) this.succeeded(startedAt);
            }),
          ),
          Effect.tapError(() =>
            Effect.sync(() => {
              if (generation !== this.#generation) return;
              this.#failures += 1;
              this.#nextReadAt = Date.now() + Math.min(USAGE_RETRY_MS * 2 ** (this.#failures - 1), USAGE_RETRY_MAX_MS);
            }),
          ),
        );
      }),
    );
  }

  /** A read that started at `startedAt` succeeded, also one that did not go through `run`. */
  succeeded(startedAt = Date.now()): void {
    this.#failures = 0;
    this.#readAt = startedAt;
    this.#nextReadAt = Date.now() + USAGE_READ_INTERVAL_MS;
  }

  /** Another login or credential: the next request reads. A read that runs now sets nothing. */
  reset(): void {
    this.#generation += 1;
    this.#failures = 0;
    this.#readAt = 0;
    this.#nextReadAt = 0;
  }
}
