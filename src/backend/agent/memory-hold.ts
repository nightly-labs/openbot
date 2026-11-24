import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect, Exit, Schedule, Scope } from "effect";
import type { HostMemory } from "../host-memory";
import type { ProviderClientOperationError } from "../provider-client-effects";

export interface MemoryHoldHooks {
  scheduleAll(): void;
  retryWaiting(): void;
  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError>;
  releaseQuietBackgroundThreads(): Effect.Effect<void, ProviderClientOperationError>;
  releaseIdleBrowserTabs(): Effect.Effect<void>;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface MemoryHoldOptions {
  memory: HostMemory | null;
  chosenTurnLimit?: () => number | "unlimited" | null;
  hooks: MemoryHoldHooks;
}

const SLOT_RETRY_INTERVAL = Duration.seconds(5);

export class MemoryHold {
  readonly #memory: HostMemory | null;
  readonly #chosenTurnLimit: () => number | "unlimited" | null;
  readonly #hooks: MemoryHoldHooks;
  #scope = Scope.makeUnsafe();
  readonly #told = new Set<string>();
  #releaseFailed = false;
  #releasing = false;
  #criticalReleased = false;
  #unsubscribe: (() => void) | null = null;

  constructor(options: MemoryHoldOptions) {
    this.#memory = options.memory;
    this.#chosenTurnLimit = options.chosenTurnLimit ?? (() => null);
    this.#hooks = options.hooks;
  }

  start(): void {
    if (this.#unsubscribe) return;
    if (!this.#memory) {
      const retry = Effect.sync(() => {
        if (typeof this.#chosenTurnLimit() === "number") this.#hooks.retryWaiting();
      }).pipe(
        Effect.repeat(Schedule.spaced(SLOT_RETRY_INTERVAL)),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      );
      Effect.runFork(retry);
      this.#unsubscribe = () => {};
      return;
    }
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

  held(agentId: string): void {
    if (this.#told.has(agentId)) return;
    this.#told.add(agentId);
    const message = this.#memory?.hostedPlan
      ? sourceText("error.agent.lowMemory")
      : sourceText("error.agent.lowMemoryServer");
    this.#hooks.emitError("host_memory_low", new Error(message), agentId);
  }

  reserveTurn(): () => void {
    return this.#memory?.reserveTurn() ?? (() => {});
  }

  turnLimit(): number | null {
    const chosen = this.#chosenTurnLimit();
    if (chosen === "unlimited") return null;
    return chosen ?? this.#memory?.turnLimit() ?? null;
  }

  readonly #sampled = Effect.fn("MemoryHold.sampled")(function* (this: MemoryHold) {
    this.#hooks.retryWaiting();
    const level = this.#memory?.level() ?? "ok";
    if (level !== "critical") this.#criticalReleased = false;
    const critical = level === "critical" && !this.#criticalReleased;
    if (!this.#releasing && level !== "ok") {
      this.#releasing = true;
      const releases = [this.#hooks.releaseQuietBackgroundThreads()];
      if (critical || this.#told.size > 0) {
        releases.push(this.#hooks.releaseIdleThreads(), this.#hooks.releaseIdleBrowserTabs());
      }
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
    if (level === "ok" && this.#told.size > 0) {
      this.#told.clear();
      this.#hooks.scheduleAll();
    }
  });
}
