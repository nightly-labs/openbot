/**
 * Holds routines while the computer sleeps, and starts them again only when the network is back.
 * A routine that fires in the first seconds after a wake runs before Wi-Fi joins and fails.
 */
export interface RoutineWakeOptions {
  routines: { suspendRoutines(): void; resumeRoutines(): void };
  isOnline: () => boolean;
  pollMs?: number;
  /** Consecutive online reads before routines resume. One read can be true before the link is up. */
  onlineReads?: number;
  /** Routines resume after this even when the computer stays offline, so they never stay held. */
  maxWaitMs?: number;
  /**
   * Routines resume after this much awake time without the resume event, so a resume that macOS or
   * Electron never delivers does not stop every schedule until the next restart.
   */
  lostResumeMs?: number;
}

/** Long enough that a maintenance wake of a few minutes does not run it out; a dark wake is shorter. */
const DEFAULT_LOST_RESUME_MS = 10 * 60_000;

export class RoutineWake {
  readonly #routines: RoutineWakeOptions["routines"];
  readonly #isOnline: () => boolean;
  readonly #pollMs: number;
  readonly #onlineReads: number;
  readonly #maxWaitMs: number;
  readonly #lostResumeMs: number;
  #poll: NodeJS.Timeout | null = null;
  #lostResume: NodeJS.Timeout | null = null;
  /** Whether a suspend still waits for its resume, so one wake resumes the routines once. */
  #suspended = false;

  constructor(options: RoutineWakeOptions) {
    this.#routines = options.routines;
    this.#isOnline = options.isOnline;
    this.#pollMs = options.pollMs ?? 2_000;
    this.#onlineReads = options.onlineReads ?? 2;
    this.#maxWaitMs = options.maxWaitMs ?? 120_000;
    this.#lostResumeMs = options.lostResumeMs ?? DEFAULT_LOST_RESUME_MS;
  }

  suspend(): void {
    this.dispose();
    this.#suspended = true;
    this.#routines.suspendRoutines();
    // The timeout freezes with the process while the computer sleeps, so it runs out only while the
    // computer is awake. A real resume or a dispose clears it, so it acts only when neither came.
    this.#lostResume = setTimeout(() => this.resume(), this.#lostResumeMs);
    this.#lostResume.unref?.();
  }

  resume(): void {
    // A reported resume that follows the lost-resume one, or one without a suspend, does nothing.
    if (!this.#suspended) return;
    this.#suspended = false;
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
