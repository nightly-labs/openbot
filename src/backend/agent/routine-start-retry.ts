import type { AgentProvider } from "../agent-client";

const DELAYS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 30 * 60_000];

export interface RoutineStartRetryOptions {
  retry(deliveryId: string, agentId: string, provider: AgentProvider): void;
}

interface Wait {
  readonly agentId: string;
  readonly provider: AgentProvider;
  readonly attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RoutineStartRetry {
  readonly #retry: RoutineStartRetryOptions["retry"];
  readonly #waits = new Map<string, Wait>();

  constructor(options: RoutineStartRetryOptions) {
    this.#retry = options.retry;
  }

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

  waiting(deliveryId: string, provider: AgentProvider): boolean {
    const wait = this.#waits.get(deliveryId);
    return Boolean(wait?.timer) && wait?.provider === provider;
  }

  agentWaits(agentId: string): boolean {
    for (const wait of this.#waits.values()) if (wait.agentId === agentId && wait.timer) return true;
    return false;
  }

  providerResumed(provider: AgentProvider): void {
    for (const wait of this.#waits.values()) {
      if (wait.provider !== provider || !wait.timer) continue;
      clearTimeout(wait.timer);
      wait.timer = null;
    }
  }

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
