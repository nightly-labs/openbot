import { Effect } from "effect";

export interface RoutineDueSource {
  nextDueAt(): string | null;
  processDue(now: Date, active: () => boolean): Effect.Effect<void, { readonly cause: unknown }>;
}

const MAX_DELAY = 60_000;
const MIN_REFIRE_GAP = 2_000;

export class RoutineTimer {
  #timer: NodeJS.Timeout | null = null;
  #firing = false;
  #suspended = false;
  #held = false;
  #lastFiredAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly sources: () => Iterable<RoutineDueSource>,
    private readonly isRunning: () => boolean,
    private readonly onError: (code: string, error: unknown) => void,
  ) {}

  arm(): void {
    if (this.#firing) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#paused() || !this.isRunning()) return;
    const earliest = this.nextDueAt();
    if (!earliest) return;
    const dueAt = new Date(earliest).getTime();
    const refireGap = this.#lastFiredAt + MIN_REFIRE_GAP - performance.now();
    const delay = Math.max(0, Math.min(dueAt - Date.now(), MAX_DELAY), refireGap);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (Date.now() < dueAt) {
        this.arm();
        return;
      }
      Effect.runFork(this.#fire());
    }, delay);
    this.#timer.unref?.();
  }

  nextDueAt(): string | null {
    let earliest: string | null = null;
    for (const source of this.sources()) {
      const dueAt = source.nextDueAt();
      if (dueAt && (!earliest || dueAt < earliest)) earliest = dueAt;
    }
    return earliest;
  }

  suspend(): void {
    this.#suspended = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  resume(): void {
    this.#suspended = false;
    this.arm();
  }

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

  readonly #fire = Effect.fn("RoutineTimer.fire")(function* (this: RoutineTimer) {
    const now = new Date();
    this.#firing = true;
    yield* Effect.gen({ self: this }, function* () {
      for (const source of this.sources()) {
        if (this.#paused()) break;
        yield* source
          .processDue(now, () => !this.#paused())
          .pipe(Effect.catch((failure) => Effect.sync(() => this.onError("routine_scheduler_failed", failure.cause))));
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#firing = false;
          this.#lastFiredAt = performance.now();
          this.arm();
        }),
      ),
    );
  }, Effect.uninterruptible);
}
