import type { AgentProvider } from "../agent-client";

/**
 * The waits before each new start of a routine run whose provider did not start, such as a start
 * with no internet connection (#6751). A run that waits longer than its schedule does not run twice:
 * the next occurrence finds this run in the queue and does not add another.
 */
const DELAYS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 30 * 60_000];

export interface RoutineStartRetryOptions {
  /** Called when the wait of a run ends: start its provider and its queue again. */
  retry(deliveryId: string, agentId: string, provider: AgentProvider): void;
}

interface Wait {
  readonly agentId: string;
  readonly provider: AgentProvider;
  /** The waits that this run had, the one that runs now included. */
  readonly attempts: number;
  /** Null when no wait runs: the run can start, and it keeps its count until it starts or fails. */
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Owns the waits of the routine runs whose provider did not start, by delivery. Nothing ran, so a
 * new start cannot do the work twice. The run stays in the queue while it waits, and the queue of
 * its lane waits with it. The drain reads `waiting`; it never imports the mailbox here.
 */
export class RoutineStartRetry {
  readonly #retry: RoutineStartRetryOptions["retry"];
  readonly #waits = new Map<string, Wait>();

  constructor(options: RoutineStartRetryOptions) {
    this.#retry = options.retry;
  }

  /**
   * Starts the next wait of this run. False when the run had all its waits. `repeatLast` keeps the
   * last wait after that, for a run that nothing else can start or fail.
   */
  schedule(deliveryId: string, agentId: string, provider: AgentProvider, repeatLast = false): boolean {
    const current = this.#waits.get(deliveryId);
    if (current?.timer) clearTimeout(current.timer);
    const attempts = current?.attempts ?? 0;
    const delayMs = DELAYS_MS[attempts] ?? (repeatLast ? DELAYS_MS.at(-1) : undefined);
    if (delayMs === undefined) {
      if (current) current.timer = null;
      return false;
    }
    const timer = setTimeout(() => {
      const wait = this.#waits.get(deliveryId);
      if (wait?.timer !== timer) return;
      wait.timer = null;
      this.#retry(deliveryId, agentId, provider);
    }, delayMs);
    timer.unref?.();
    this.#waits.set(deliveryId, { agentId, provider, attempts: attempts + 1, timer });
    return true;
  }

  /**
   * True while this run waits for its next start on `provider`. A run whose agent moved to another
   * provider does not wait for the old one.
   */
  waiting(deliveryId: string, provider: AgentProvider): boolean {
    const wait = this.#waits.get(deliveryId);
    return Boolean(wait?.timer) && wait?.provider === provider;
  }

  /** True while a run of this agent waits. The drain reads this before it reads the queue. */
  agentWaits(agentId: string): boolean {
    for (const wait of this.#waits.values()) if (wait.agentId === agentId && wait.timer) return true;
    return false;
  }

  /** The provider is available again, so the runs that wait for it can start now. */
  providerResumed(provider: AgentProvider): void {
    for (const wait of this.#waits.values()) {
      if (wait.provider !== provider || !wait.timer) continue;
      clearTimeout(wait.timer);
      wait.timer = null;
    }
  }

  /** The run started, failed, or left the queue. */
  forget(deliveryId: string): void {
    const wait = this.#waits.get(deliveryId);
    if (wait?.timer) clearTimeout(wait.timer);
    this.#waits.delete(deliveryId);
  }

  forgetAgent(agentId: string): void {
    for (const [deliveryId, wait] of this.#waits) if (wait.agentId === agentId) this.forget(deliveryId);
  }

  dispose(): void {
    for (const deliveryId of [...this.#waits.keys()]) this.forget(deliveryId);
  }
}
