import { net } from "electron";

export interface NetworkReturnedOptions {
  /** Whether the computer is online. The default reads Electron's own view of the link. */
  isOnline?: () => boolean;
  /** How often the link is read. The main process has no network event to listen to. */
  pollMs?: number;
  /** Called when the link comes back after it was away. */
  onReturned: () => void;
}

const DEFAULT_POLL_MS = 5_000;

/**
 * Reports when the computer's network returns. Electron gives the main process no `online` event,
 * so the link is read on an unref'd interval and a false-to-true change is the return. The interval
 * freezes with the process while the computer sleeps, so a wake reports the return as well, beside
 * the wake handler of its own.
 */
export class NetworkReturned {
  readonly #isOnline: () => boolean;
  readonly #pollMs: number;
  readonly #onReturned: () => void;
  #timer: NodeJS.Timeout | null = null;
  #online: boolean;

  constructor(options: NetworkReturnedOptions) {
    this.#isOnline = options.isOnline ?? (() => net.isOnline());
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.#onReturned = options.onReturned;
    this.#online = this.#isOnline();
    this.#timer = setInterval(() => this.#check(), this.#pollMs);
    this.#timer.unref?.();
  }

  #check(): void {
    const online = this.#isOnline();
    if (online === this.#online) return;
    this.#online = online;
    // Only the return reports: the away side is for the servers' own backoff to handle.
    if (online) this.#onReturned();
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
