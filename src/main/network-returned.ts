export interface NetworkReturnedOptions {
  /** Whether the computer is online. */
  isOnline: () => boolean;
  /** How often the link is read. The main process has no network event to listen to. */
  pollMs?: number;
  /** Consecutive online reads before a return reports. One read can be true before the link is up. */
  onlineReads?: number;
  /** A return this close to the previous one does not report, so a flapping link wakes no storm. */
  minGapMs?: number;
  /** Called when the link comes back after it was away. */
  onReturned: () => void;
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_ONLINE_READS = 2;
const DEFAULT_MIN_GAP_MS = 30_000;

/**
 * Reports when the computer's network returns. Electron gives the main process no `online` event,
 * so the link is read on an unref'd interval. A return needs several online reads in a row,
 * because one read can be true before the link is up — the same reason `RoutineWake` waits for two
 * — and a return too near the previous one stays unreported: the servers' own backoff answers a
 * flapping link. The interval freezes with the process while the computer sleeps, so a wake
 * reports the return as well, beside the wake handler of its own.
 */
export class NetworkReturned {
  readonly #isOnline: () => boolean;
  readonly #pollMs: number;
  readonly #onlineReads: number;
  readonly #minGapMs: number;
  readonly #onReturned: () => void;
  #timer: NodeJS.Timeout | null = null;
  #away: boolean;
  /** Consecutive online reads since the link went away. */
  #streak = 0;
  #lastReportedAt: number | null = null;

  constructor(options: NetworkReturnedOptions) {
    this.#isOnline = options.isOnline;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.#onlineReads = options.onlineReads ?? DEFAULT_ONLINE_READS;
    this.#minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.#onReturned = options.onReturned;
    this.#away = !this.#isOnline();
    this.#timer = setInterval(() => this.#check(), this.#pollMs);
    this.#timer.unref?.();
  }

  #check(): void {
    if (!this.#isOnline()) {
      this.#away = true;
      this.#streak = 0;
      return;
    }
    if (!this.#away) return;
    this.#streak += 1;
    if (this.#streak < this.#onlineReads) return;
    this.#streak = 0;
    // A return inside the gap stays pending: the link keeps reading online, and the report goes out
    // on a later read once the gap has passed.
    if (this.#lastReportedAt !== null && Date.now() - this.#lastReportedAt < this.#minGapMs) return;
    this.#away = false;
    this.#lastReportedAt = Date.now();
    // Only the return reports: the away side is for the servers' own backoff to handle.
    this.#onReturned();
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
