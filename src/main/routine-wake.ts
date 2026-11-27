export interface RoutineWakeOptions {
  routines: { suspendRoutines(): void; resumeRoutines(): void };
  isOnline: () => boolean;
  pollMs?: number;
  onlineReads?: number;
  maxWaitMs?: number;
}

const LOST_RESUME_MS = 10 * 60_000;

export class RoutineWake {
  readonly #routines: RoutineWakeOptions["routines"];
  readonly #isOnline: () => boolean;
  readonly #pollMs: number;
  readonly #onlineReads: number;
  readonly #maxWaitMs: number;
  #poll: NodeJS.Timeout | null = null;
  #lostResume: NodeJS.Timeout | null = null;

  constructor(options: RoutineWakeOptions) {
    this.#routines = options.routines;
    this.#isOnline = options.isOnline;
    this.#pollMs = options.pollMs ?? 2_000;
    this.#onlineReads = options.onlineReads ?? 2;
    this.#maxWaitMs = options.maxWaitMs ?? 120_000;
  }

  suspend(): void {
    this.dispose();
    this.#routines.suspendRoutines();
    this.#lostResume = setTimeout(() => this.resume(), LOST_RESUME_MS);
    this.#lostResume.unref?.();
  }

  resume(): void {
    this.dispose();
    const deadline = Date.now() + this.#maxWaitMs;
    let reads = 0;
    const check = () => {
      reads = this.#isOnline() ? reads + 1 : 0;
      if (reads >= this.#onlineReads || Date.now() >= deadline) {
        this.#poll = null;
        this.#routines.resumeRoutines();
        return;
      }
      this.#poll = setTimeout(check, this.#pollMs);
      this.#poll.unref?.();
    };
    check();
  }

  dispose(): void {
    if (this.#poll) clearTimeout(this.#poll);
    this.#poll = null;
    if (this.#lostResume) clearTimeout(this.#lostResume);
    this.#lostResume = null;
  }
}
