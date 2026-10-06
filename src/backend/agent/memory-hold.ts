import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Scope } from "effect";
import type { HostMemory, HostMemoryLevel } from "../host-memory";
import type { ProviderClientOperationError } from "../provider-client-effects";

export interface MemoryHoldHooks {
  /** Tries each agent again. The memory is back, so a delivery that waited can start. */
  scheduleAll(): void;
  /**
   * Tries the agents that wait for a turn slot again. A slot can free on a path that schedules no
   * drain, so each sample is also a retry.
   */
  retryWaiting(): void;
  /** Closes the provider threads that have no turn. They open again from their session. */
  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError>;
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
  #scope = Scope.makeUnsafe();
  readonly #told = new Set<string>();
  #level: HostMemoryLevel = "ok";
  #unsubscribe: (() => void) | null = null;

  constructor(options: MemoryHoldOptions) {
    this.#memory = options.memory;
    this.#hooks = options.hooks;
  }

  start(): void {
    if (!this.#memory || this.#unsubscribe) return;
    this.#unsubscribe = this.#memory.subscribe(() =>
      Effect.runFork(this.#sampled().pipe(Effect.forkIn(this.#scope, { startImmediately: true }))),
    );
  }

  readonly dispose = Effect.fn("MemoryHold.dispose")(function* (this: MemoryHold) {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }).bind(this);

  mayDrain(_agentId: string): boolean {
    return (this.#memory?.level() ?? "ok") === "ok";
  }

  /** Tells the agent that its delivery waits for memory, one time in this low period. */
  held(agentId: string): void {
    if (this.#told.has(agentId)) return;
    this.#told.add(agentId);
    this.#hooks.emitError("host_memory_low", new Error(sourceText("error.agent.lowMemory")), agentId);
  }

  /** Returns the release, for a start that ends with no turn. */
  reserveTurn(): () => void {
    return this.#memory?.reserveTurn() ?? (() => {});
  }

  /** The most turns that run at the same time, or null for no limit. */
  turnLimit(): number | null {
    return this.#memory?.turnLimit() ?? null;
  }

  readonly #sampled = Effect.fn("MemoryHold.sampled")(function* (this: MemoryHold) {
    this.#hooks.retryWaiting();
    const level = this.#memory?.level() ?? "ok";
    const previous = this.#level;
    this.#level = level;
    if (level === "critical" && previous !== "critical")
      yield* this.#hooks
        .releaseIdleThreads()
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("idle_thread_release_failed", failure.cause)),
          ),
        );
    // By the held agents, not by the last level: a turn reservation can hold an agent between two
    // samples that both read "ok".
    if (level === "ok" && this.#told.size > 0) {
      this.#told.clear();
      this.#hooks.scheduleAll();
    }
  });
}
