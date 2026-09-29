import { sourceText } from "@openbot/i18n/source";
import type { HostMemory, HostMemoryLevel } from "../host-memory";

export interface MemoryHoldHooks {
  /** Tries each agent again. The memory is back, so a delivery that waited can start. */
  scheduleAll(): void;
  /**
   * Tries the agents that wait for a turn slot again. A slot can free on a path that schedules no
   * drain, so each sample is also a retry.
   */
  retryWaiting(): void;
  /** Closes the provider threads that have no turn. They open again from their session. */
  releaseIdleThreads(): void;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface MemoryHoldOptions {
  /** Null on a computer that is not a hosted server: nothing is held there. */
  memory: HostMemory | null;
  hooks: MemoryHoldHooks;
}

/**
 * Owns the memory clause of the queue drain. While the machine is low on memory no new turn starts,
 * and the delivery stays queued: a message to a busy machine waits, as it does for a busy agent. Each
 * held agent is told one time in each low period. At a critical level the idle provider threads close.
 * It never imports the service.
 */
export class MemoryHold {
  readonly #memory: HostMemory | null;
  readonly #hooks: MemoryHoldHooks;
  readonly #told = new Set<string>();
  #level: HostMemoryLevel = "ok";
  #unsubscribe: (() => void) | null = null;

  constructor(options: MemoryHoldOptions) {
    this.#memory = options.memory;
    this.#hooks = options.hooks;
  }

  start(): void {
    if (!this.#memory || this.#unsubscribe) return;
    this.#unsubscribe = this.#memory.subscribe(() => this.#sampled());
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  mayDrain(_agentId: string): boolean {
    return (this.#memory?.level() ?? "ok") === "ok";
  }

  /** Tells the agent that its delivery waits for memory, one time in this low period. */
  held(agentId: string): void {
    if (this.#told.has(agentId)) return;
    this.#told.add(agentId);
    this.#hooks.emitError("host_memory_low", new Error(sourceText("error.agent.lowMemory")), agentId);
  }

  reserveTurn(): void {
    this.#memory?.reserveTurn();
  }

  /** The most turns that run at the same time, or null for no limit. */
  turnLimit(): number | null {
    return this.#memory?.turnLimit() ?? null;
  }

  #sampled(): void {
    this.#hooks.retryWaiting();
    const level = this.#memory?.level() ?? "ok";
    const previous = this.#level;
    this.#level = level;
    if (level === "critical" && previous !== "critical") this.#hooks.releaseIdleThreads();
    // By the held agents, not by the last level: a turn reservation can hold an agent between two
    // samples that both read "ok".
    if (level === "ok" && this.#told.size > 0) {
      this.#told.clear();
      this.#hooks.scheduleAll();
    }
  }
}
