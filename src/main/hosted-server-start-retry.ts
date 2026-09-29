/**
 * A hosted server has nobody to press Retry, so it publishes the host again after a failed start. A
 * start that could not sign in leaves the host idle or unconfigured, so those phases also start again.
 * Nothing here stops the server. The Worker stops it when it reports no use (`HostedServerActivity`).
 */

import type { HostPhase } from "@openbot/contracts/ipc";

const CHECK_INTERVAL_MS = 60_000;
const START_RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];
const RETRY_PHASES: ReadonlySet<HostPhase> = new Set(["error", "idle", "unconfigured"]);

export interface HostedServerStartRetryOptions {
  hostPhase: () => HostPhase;
  /** Signs in again when the first start could not, then publishes the host. */
  startHost: () => Promise<unknown>;
  onError: (message: string, error: unknown) => void;
  now?: () => number;
}

export class HostedServerStartRetry {
  readonly #options: HostedServerStartRetryOptions;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Promise<void> | null = null;
  #startFailures = 0;
  #nextStartAt = 0;

  constructor(options: HostedServerStartRetryOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.tick().catch((error) => this.#options.onError("The hosted server start retry failed.", error));
    }, CHECK_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  tick(): Promise<void> {
    this.#pending ??= this.#tick().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #tick(): Promise<void> {
    const now = this.#now();
    const phase = this.#options.hostPhase();
    if (phase === "online") {
      this.#startFailures = 0;
      this.#nextStartAt = 0;
      return;
    }
    if (!RETRY_PHASES.has(phase) || now < this.#nextStartAt) return;
    const delay = START_RETRY_DELAYS_MS[Math.min(this.#startFailures, START_RETRY_DELAYS_MS.length - 1)] ?? 0;
    this.#startFailures += 1;
    this.#nextStartAt = now + delay;
    await this.#options.startHost();
  }
}
