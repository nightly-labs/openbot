import { Effect } from "effect";

/**
 * One timeout for every routine owner. Two schedulers each holding their own `setTimeout` would
 * fight: each arms from its own store, so whichever armed last would decide when the process wakes
 * and the other owner's earlier routine would fire late.
 *
 * `arm()` therefore re-derives the wake time from every source. Because every stored timestamp is
 * an ISO string from `Date#toISOString()`, string order is time order - the same fact the routine
 * SQL already depends on - so the earliest due time is a plain lexicographic minimum.
 */
export interface RoutineDueSource {
  nextDueAt(): string | null;
  /** `active` turns false when the system suspends during the pass; stop before the next routine. */
  processDue(now: Date, active: () => boolean): Effect.Effect<void, { readonly cause: unknown }>;
}

/** `setTimeout` rejects a delay above this and fires at once instead, which would spin. */
const MAX_DELAY = 2_147_000_000;

export class RoutineTimer {
  #timer: NodeJS.Timeout | null = null;
  #firing = false;
  #suspended = false;
  /** A restart of the app waits for the agents to be idle, so no routine may start new work. */
  #held = false;

  constructor(
    private readonly sources: () => Iterable<RoutineDueSource>,
    private readonly isRunning: () => boolean,
    private readonly onError: (code: string, error: unknown) => void,
  ) {}

  arm(): void {
    // A pass owns the wake until it ends. A fire writes, a write arms the timer, and a routine
    // that the pass has not reached yet is still due: a second pass would fire it while the first
    // one holds the list that still names it. Every pass ends in `arm()`, which reads the sources
    // again, so a change that arrives during a pass is answered, not lost.
    if (this.#firing) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#paused() || !this.isRunning()) return;
    const earliest = this.nextDueAt();
    if (!earliest) return;
    const delay = Math.max(0, Math.min(new Date(earliest).getTime() - Date.now(), MAX_DELAY));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      Effect.runFork(this.#fire());
    }, delay);
    this.#timer.unref?.();
  }

  /** The earliest due time of all sources, or null when no routine is scheduled. */
  nextDueAt(): string | null {
    let earliest: string | null = null;
    for (const source of this.sources()) {
      const dueAt = source.nextDueAt();
      if (dueAt && (!earliest || dueAt < earliest)) earliest = dueAt;
    }
    return earliest;
  }

  /**
   * The system is going to sleep. A timer left armed can still fire in a dark wake, where the
   * network is down and the run waits until the full wake, so each one becomes a queued duplicate.
   */
  suspend(): void {
    this.#suspended = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Every occurrence missed while suspended collapses into one run in the next pass. */
  resume(): void {
    this.#suspended = false;
    this.arm();
  }

  /**
   * Holds routine firing apart from a system sleep, so a resume from sleep does not release it.
   * A routine that comes due meanwhile runs when `release` is called, or when the app starts again.
   */
  hold(): void {
    this.#held = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  get held(): boolean {
    return this.#held;
  }

  release(): void {
    this.#held = false;
    this.arm();
  }

  #paused(): boolean {
    return this.#suspended || this.#held;
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Every source is asked, and one that throws must not stop the others or stop the re-arm: a
   * failure to fire an agent routine would otherwise leave the process asleep for good.
   */

  readonly #fire = Effect.fn("RoutineTimer.fire")(function* (this: RoutineTimer) {
    const now = new Date();
    this.#firing = true;
    yield* Effect.gen({ self: this }, function* () {
      for (const source of this.sources()) {
        // A suspend or a hold can arrive while an enqueue awaits. The rest stays due and fires later.
        if (this.#paused()) break;
        yield* source
          .processDue(now, () => !this.#paused())
          .pipe(Effect.catch((failure) => Effect.sync(() => this.onError("routine_scheduler_failed", failure.cause))));
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#firing = false;
          this.arm();
        }),
      ),
    );
  }, Effect.uninterruptible);
}
