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
  processDue(now: Date): Promise<void>;
}

/** `setTimeout` rejects a delay above this and fires at once instead, which would spin. */
const MAX_DELAY = 2_147_000_000;

export class RoutineTimer {
  #timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sources: () => Iterable<RoutineDueSource>,
    private readonly isRunning: () => boolean,
    private readonly onError: (code: string, error: unknown) => void,
  ) {}

  arm(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.isRunning()) return;
    let earliest: string | null = null;
    for (const source of this.sources()) {
      const dueAt = source.nextDueAt();
      if (dueAt && (!earliest || dueAt < earliest)) earliest = dueAt;
    }
    if (!earliest) return;
    const delay = Math.max(0, Math.min(new Date(earliest).getTime() - Date.now(), MAX_DELAY));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#fire();
    }, delay);
    this.#timer.unref?.();
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Every source is asked, and one that throws must not stop the others or stop the re-arm: a
   * failure to fire an agent routine would otherwise leave the process asleep for good.
   */
  async #fire(): Promise<void> {
    const now = new Date();
    for (const source of this.sources()) {
      try {
        await source.processDue(now);
      } catch (error) {
        this.onError("routine_scheduler_failed", error);
      }
    }
    this.arm();
  }
}
