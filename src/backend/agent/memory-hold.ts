import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Scope } from "effect";
import type { HostMemory } from "../host-memory";
import type { ProviderClientOperationError } from "../provider-client-effects";

export interface MemoryHoldHooks {
  /** Tries each agent again. The memory is back, so a delivery that waited can start. */
  scheduleAll(): void;
  /**
   * Tries the agents that wait for a turn slot again. A slot can free on a path that schedules no
   * drain, so each sample is also a retry.
   */
  retryWaiting(): void;
  /**
   * Closes the provider threads that have no turn. They open again from their session. Called at each
   * sample while a delivery is held, so a call with no idle thread must do nothing.
   */
  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Closes the provider threads that only background work holds, when that work sent nothing for a
   * long time. Called at each low sample, so a call with no such thread must do nothing.
   */
  releaseQuietBackgroundThreads(): Effect.Effect<void, ProviderClientOperationError>;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface MemoryHoldOptions {
  /** Null on a desktop computer: nothing is held there. */
  memory: HostMemory | null;
  hooks: MemoryHoldHooks;
}

/**
 * Owns the memory clause of the queue drain. While the machine is low on memory no new turn starts,
 * and the delivery stays queued: a message to a busy machine waits, as it does for a busy agent. Each
 * held agent is told one time in each low period. At a critical level, and while a delivery is held,
 * the idle provider threads close. At each low sample, the threads that only quiet background work
 * holds close.
 * It never imports the service.
 */
export class MemoryHold {
  readonly #memory: HostMemory | null;
  readonly #hooks: MemoryHoldHooks;
  #scope = Scope.makeUnsafe();
  readonly #told = new Set<string>();
  /**
   * A failed release is reported one time in each low period, and at each change to critical: a held
   * delivery retries it at each sample.
   */
  #releaseFailed = false;
  /** A sample comes each 5 s, and a provider can take longer to stop its idle threads. */
  #releasing = false;
  /** The idle threads were released in this critical period, so a sample in a release cannot skip it. */
  #criticalReleased = false;
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
    const message = this.#memory?.hostedPlan
      ? sourceText("error.agent.lowMemory")
      : sourceText("error.agent.lowMemoryServer");
    this.#hooks.emitError("host_memory_low", new Error(message), agentId);
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
    if (level !== "critical") this.#criticalReleased = false;
    // While a delivery waits, at each sample: an idle thread costs only a slower first message, and
    // its timer could hold the queue for minutes with no turn running (#4676).
    const critical = level === "critical" && !this.#criticalReleased;
    if (!this.#releasing && level !== "ok") {
      this.#releasing = true;
      // Background work that sent nothing for a long time holds a whole process, also when no
      // delivery waits.
      const releases = [this.#hooks.releaseQuietBackgroundThreads()];
      if (critical || this.#told.size > 0) releases.push(this.#hooks.releaseIdleThreads());
      if (critical) this.#criticalReleased = true;
      yield* Effect.forEach(
        releases,
        (release) =>
          release.pipe(
            Effect.catch((failure) =>
              Effect.sync(() => {
                if (this.#releaseFailed && !critical) return;
                this.#releaseFailed = true;
                this.#hooks.emitError("idle_thread_release_failed", failure.cause);
              }),
            ),
          ),
        { discard: true },
      ).pipe(Effect.ensuring(Effect.sync(() => (this.#releasing = false))));
    }
    if (level === "ok") this.#releaseFailed = false;
    // By the held agents, not by the last level: a turn reservation can hold an agent between two
    // samples that both read "ok".
    if (level === "ok" && this.#told.size > 0) {
      this.#told.clear();
      this.#hooks.scheduleAll();
    }
  });
}
