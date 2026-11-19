import { Effect, Semaphore } from "effect";

const USAGE_READ_INTERVAL_MS = 4 * 60_000;
const USAGE_RETRY_MS = 5 * 60_000;
const USAGE_RETRY_MAX_MS = 60 * 60_000;

export class UsageReadGate {
  #nextReadAt = 0;
  #readAt = 0;
  #failures = 0;
  #generation = 0;
  readonly #lock = Semaphore.makeUnsafe(1);

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
          Effect.tapError(() => Effect.sync(() => this.#failed(generation))),
        );
      }),
    );
  }

  unlessWaiting<A, E, R>(options: { read: Effect.Effect<A, E, R>; waiting: () => A }): Effect.Effect<A, E, R> {
    return Effect.suspend(() => {
      if (this.#failures > 0 && Date.now() < this.#nextReadAt) return Effect.succeed(options.waiting());
      const generation = this.#generation;
      return options.read.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (generation === this.#generation) this.#failures = 0;
          }),
        ),
        Effect.tapError(() => Effect.sync(() => this.#failed(generation))),
      );
    });
  }

  #failed(generation: number): void {
    if (generation !== this.#generation) return;
    this.#failures += 1;
    this.#nextReadAt = Date.now() + Math.min(USAGE_RETRY_MS * 2 ** (this.#failures - 1), USAGE_RETRY_MAX_MS);
  }

  succeeded(startedAt = Date.now()): void {
    this.#failures = 0;
    this.#readAt = startedAt;
    this.#nextReadAt = Date.now() + USAGE_READ_INTERVAL_MS;
  }

  reset(): void {
    this.#generation += 1;
    this.#failures = 0;
    this.#readAt = 0;
    this.#nextReadAt = 0;
  }
}
