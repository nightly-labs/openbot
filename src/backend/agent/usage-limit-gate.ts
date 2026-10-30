import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AccountUsage, AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Schema, Scope } from "effect";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import { agentProviderAccount as accountOf, providerForAgent } from "./thread-items";

/** A provider client's report that the plan refused this turn, with the reset in epoch seconds when it gave one. */
export const USAGE_LIMIT_METHOD = "openbot/usageLimit";

/**
 * How often a limit with no reported reset, or with a reset from a usage reading, is read again. A
 * usage read is one request, not a turn.
 */
const USAGE_LIMIT_RECHECK_MS = 15 * 60_000;

/** Time after the reported reset before work starts again, so the provider's clock has passed it too. */
const RESET_GRACE_MS = 30_000;

/**
 * How long a model that failed a turn with a provider error is passed over, so an agent on a backup
 * does not go back to a model that still fails at once. A provider error names no reset.
 */
const PROVIDER_FAILURE_HOLD_MS = 10 * 60_000;

/** The longest delay `setTimeout` keeps. A longer wait is armed again when it fires. */
const MAX_TIMER_MS = 2_147_483_647;

export interface UsageLimitHooks {
  emit(event: AgentEvent): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  /** The account's usage reading for this model, or null when it gives none. A null account is the provider's own sign-in. */
  readUsage(
    provider: AgentProvider,
    model: string,
    accountId: string | null,
  ): Effect.Effect<AccountUsage | null, UsageReadFailed>;
  /** The agents a limit now holds, each time a refused turn reports it. Must not wait for their queues. */
  held(agentIds: readonly string[]): Effect.Effect<void>;
  /** A limit ended, after its agents' drains were scheduled. Must not wait for the work it starts. */
  released(limit: UsageLimitKey): Effect.Effect<void>;
}

export interface UsageLimitGateOptions {
  store: AgentStore;
  hooks: UsageLimitHooks;
}

export interface UsageLimitKey {
  provider: AgentProvider;
  /** The provider account after the first, or null for the provider's own sign-in. */
  accountId: string | null;
  model: string;
}

interface ProviderFailure extends UsageLimitKey {
  timer: ReturnType<typeof setTimeout>;
}

interface UsageLimit extends UsageLimitKey {
  /** Epoch seconds, or null while the provider has not said. */
  resetsAt: number | null;
  /**
   * The reset came from a usage reading, not from the refusal. The provider can end such a limit
   * before it, as when a reset credit is spent in the Codex app, so it is read again.
   */
  resetFromUsage: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The plan limits of the provider accounts, and the queues they hold.
 *
 * Owns one entry per provider account and model whose last turn the plan refused. While an entry exists, no
 * agent on that provider and model starts a turn: its messages and routine runs stay queued instead
 * of failing one by one. A model is part of the key because a weekly window can cover one model
 * family only; an account-wide window costs each other model one refused, requeued turn.
 *
 * The entry ends at the reported reset, after a usage read that finds no spent window, or when a
 * turn on that provider and model completes. It is kept in memory only: after a restart the first
 * refused turn closes the gate again.
 *
 * It also owns the models that failed a turn with a provider error. They hold no queue: they only
 * move agents set to switch without asking to a backup, and keep them there for a while.
 */
export class UsageLimitGate {
  readonly #store: AgentStore;
  readonly #hooks: UsageLimitHooks;
  readonly #limits = new Map<string, UsageLimit>();
  /** Owns the usage reads and the timer runs, so `dispose` stops them. */
  #scope = Scope.makeUnsafe();
  /** Providers the user was told about in this limit, so a limit that closes again is not announced twice. */
  readonly #announced = new Set<AgentProvider>();
  readonly #failures = new Map<string, ProviderFailure>();

  constructor(options: UsageLimitGateOptions) {
    this.#store = options.store;
    this.#hooks = options.hooks;
  }

  mayDrain(agentId: string): boolean {
    const agent = this.#agent(agentId);
    return !agent || !this.#limits.has(limitKey(providerForAgent(agent), accountOf(agent), agent.model));
  }

  /** Whether a limit holds this provider account and model. */
  isLimited(limit: UsageLimitKey): boolean {
    return this.#limits.has(limitKey(limit.provider, limit.accountId, limit.model));
  }

  /**
   * The provider account and model that `failed` would hold for this agent's turn on `model`, as one
   * key. Null when the agent no longer exists.
   */
  failureKey(agentId: string, model: string | null = null): string | null {
    const agent = this.#agent(agentId);
    return agent ? limitKey(providerForAgent(agent), accountOf(agent), model ?? agent.model) : null;
  }

  /** Whether a provider error passes over this provider account and model. */
  isFailed(limit: UsageLimitKey): boolean {
    return this.#failures.has(limitKey(limit.provider, limit.accountId, limit.model));
  }

  /**
   * A provider error failed a turn of this agent on `model`, the agent's current model when null.
   * The model is passed over until the hold ends or a turn on it completes. Then the agents that
   * left it go back.
   */
  failed(agentId: string, model: string | null = null): void {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const accountId = accountOf(agent);
    const turnModel = model ?? agent.model;
    const key = limitKey(provider, accountId, turnModel);
    const previous = this.#failures.get(key);
    if (previous) clearTimeout(previous.timer);
    this.#failures.set(key, {
      provider,
      accountId,
      model: turnModel,
      timer: setTimeout(
        () => Effect.runFork(this.#releaseFailure(key).pipe(Effect.forkIn(this.#scope))),
        PROVIDER_FAILURE_HOLD_MS,
      ),
    });
  }

  /** The agents whose queue a limit holds, for the runtime snapshot. */
  limitedAgents(): NonNullable<AgentRuntimeSnapshot["usageLimits"]> {
    return this.#store.list().flatMap((agent) => {
      const limit = this.#limits.get(limitKey(providerForAgent(agent), accountOf(agent), agent.model));
      return limit ? [{ agentId: agent.id, resetsAt: limit.resetsAt }] : [];
    });
  }

  /** Each provider account and model that a limit holds, for the runtime snapshot. */
  limitedModels(): NonNullable<AgentRuntimeSnapshot["usageLimitedModels"]> {
    return [...this.#limits.values()].slice(0, INPUT_LIMITS.agents).map((limit) => ({
      provider: limit.provider,
      model: limit.model,
      ...(limit.accountId ? { providerAccountId: limit.accountId } : {}),
    }));
  }

  /**
   * The plan refused a turn of this agent. `resetsAt` is in epoch seconds. `model` is the one the
   * turn ran on; the agent's current model when null.
   */
  readonly reached = Effect.fn("UsageLimitGate.reached")(function* (
    this: UsageLimitGate,
    agentId: string,
    resetsAt: number | null,
    model: string | null = null,
  ) {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const turnModel = model ?? agent.model;
    const accountId = accountOf(agent);
    const key = limitKey(provider, accountId, turnModel);
    const limit = this.#limits.get(key) ?? {
      provider,
      accountId,
      model: turnModel,
      resetsAt: null,
      resetFromUsage: false,
      timer: null,
    };
    // A reset already past would release the queue at once into the same refusal.
    const future = (value: number | null) => (value !== null && value * 1_000 > Date.now() ? value : null);
    const named = future(resetsAt);
    limit.resetsAt = named ?? future(limit.resetsAt);
    if (named !== null) limit.resetFromUsage = false;
    this.#limits.set(key, limit);
    this.#arm(key, limit);
    yield* this.#hooks.held(this.#heldAgents(limit).map((held) => held.id));
    this.#hooks.emitRuntimeSnapshot();
    if (limit.resetsAt !== null) {
      this.#announce(agentId, limit);
      return;
    }
    // A provider that names no reset in its refusal usually reports it in its usage reading.
    yield* this.#readReset(key, limit).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#limits.get(key) === limit) this.#announce(agentId, limit);
        }),
      ),
      Effect.forkIn(this.#scope),
    );
  }).bind(this);

  /** A turn of this agent completed on `model`, so its provider and model take turns again. */
  readonly completed = Effect.fn("UsageLimitGate.completed")(function* (
    this: UsageLimitGate,
    agentId: string,
    model: string | null = null,
  ) {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const key = limitKey(provider, accountOf(agent), model ?? agent.model);
    if (this.#limits.has(key)) yield* this.#release(key);
    if (this.#failures.has(key)) yield* this.#releaseFailure(key);
    if (![...this.#limits.values()].some((limit) => limit.provider === provider)) this.#announced.delete(provider);
  }).bind(this);

  /**
   * The user spent a usage reset credit of a provider account, so each limit of that account ends now
   * and its agents take turns again. A null account is the provider's own sign-in.
   */
  readonly accountReset = Effect.fn("UsageLimitGate.accountReset")(function* (
    this: UsageLimitGate,
    provider: AgentProvider,
    accountId: string | null,
  ) {
    for (const [key, limit] of [...this.#limits])
      if (limit.provider === provider && limit.accountId === accountId) yield* this.#release(key, true);
  }).bind(this);

  readonly dispose = Effect.fn("UsageLimitGate.dispose")(function* (this: UsageLimitGate) {
    for (const limit of this.#limits.values()) if (limit.timer) clearTimeout(limit.timer);
    this.#limits.clear();
    for (const failure of this.#failures.values()) clearTimeout(failure.timer);
    this.#failures.clear();
    this.#announced.clear();
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }).bind(this);

  #agent(agentId: string) {
    return this.#store.list().find((candidate) => candidate.id === agentId);
  }

  #announce(agentId: string, limit: UsageLimit): void {
    if (this.#announced.has(limit.provider)) return;
    this.#announced.add(limit.provider);
    this.#hooks.emit({
      type: "usage-limit-reached",
      agentId,
      provider: limit.provider,
      resetsAt: limit.resetsAt,
      agentCount: this.#heldAgents(limit).length,
    });
  }

  #arm(key: string, limit: UsageLimit): void {
    if (limit.timer) clearTimeout(limit.timer);
    const untilReset =
      limit.resetsAt === null ? USAGE_LIMIT_RECHECK_MS : limit.resetsAt * 1_000 - Date.now() + RESET_GRACE_MS;
    const delay = limit.resetFromUsage ? Math.min(untilReset, USAGE_LIMIT_RECHECK_MS) : untilReset;
    limit.timer = setTimeout(
      () => Effect.runFork(this.#fire(key, limit).pipe(Effect.forkIn(this.#scope))),
      Math.max(0, Math.min(delay, MAX_TIMER_MS)),
    );
  }

  readonly #fire = Effect.fn("UsageLimitGate.fire")(function* (this: UsageLimitGate, key: string, limit: UsageLimit) {
    if (this.#limits.get(key) !== limit) return;
    limit.timer = null;
    if (limit.resetsAt !== null && limit.resetsAt * 1_000 + RESET_GRACE_MS <= Date.now()) {
      yield* this.#release(key, true);
      return;
    }
    if (limit.resetsAt !== null && !limit.resetFromUsage) {
      this.#arm(key, limit);
      return;
    }
    // A reading that still shows a spent window gives the reset, and one that shows none lets one turn
    // try. With no reset known, no reading lets one turn try too; a reset from a reading waits for it.
    const known = limit.resetsAt !== null;
    const resetsAt = yield* this.#readReset(key, limit);
    if (this.#limits.get(key) !== limit || typeof resetsAt === "number") return;
    if (resetsAt === null || !known) yield* this.#release(key);
    else this.#arm(key, limit);
  });

  /**
   * Reads the reset of the spent window into `limit` and arms it. Null when the reading shows none,
   * undefined when there is no reading, it fails, or it has no window.
   */
  readonly #readReset = Effect.fn("UsageLimitGate.readReset")(function* (
    this: UsageLimitGate,
    key: string,
    limit: UsageLimit,
  ) {
    const usage = yield* this.#hooks
      .readUsage(limit.provider, limit.model, limit.accountId)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (this.#limits.get(key) !== limit) return null;
    // A reset that a refusal named while the reading ran stays.
    if (limit.resetsAt !== null && !limit.resetFromUsage) return limit.resetsAt;
    // A provider that does not run, or a reading that does not cover the model, has no window.
    if (!usage?.limits.some((reading) => reading.primary || reading.secondary)) return undefined;
    const resetsAt = spentWindowReset(usage);
    if (resetsAt === null) return null;
    const changed = limit.resetsAt !== resetsAt;
    limit.resetsAt = resetsAt;
    limit.resetFromUsage = true;
    this.#arm(key, limit);
    if (changed) this.#hooks.emitRuntimeSnapshot();
    return resetsAt;
  });

  /**
   * Ends a limit. At the reset the provider reported, the limit is over, so the next one is announced
   * again. A probe of a limit with no known reset keeps the announcement: the next refused turn may
   * only close the same limit again.
   */
  readonly #release = Effect.fn("UsageLimitGate.release")(function* (this: UsageLimitGate, key: string, reset = false) {
    const limit = this.#limits.get(key);
    if (!limit) return;
    if (limit.timer) clearTimeout(limit.timer);
    this.#limits.delete(key);
    if (reset && ![...this.#limits.values()].some((other) => other.provider === limit.provider))
      this.#announced.delete(limit.provider);
    this.#hooks.emitRuntimeSnapshot();
    for (const agent of this.#heldAgents(limit)) this.#hooks.scheduleDrain(agent.id);
    yield* this.#hooks.released({ provider: limit.provider, accountId: limit.accountId, model: limit.model });
  });

  readonly #releaseFailure = Effect.fn("UsageLimitGate.releaseFailure")(function* (this: UsageLimitGate, key: string) {
    const failure = this.#failures.get(key);
    if (!failure) return;
    clearTimeout(failure.timer);
    this.#failures.delete(key);
    yield* this.#hooks.released({ provider: failure.provider, accountId: failure.accountId, model: failure.model });
  });

  #heldAgents(limit: UsageLimit) {
    return this.#store
      .list()
      .filter(
        (agent) =>
          providerForAgent(agent) === limit.provider &&
          accountOf(agent) === limit.accountId &&
          agent.model === limit.model,
      );
  }
}

function limitKey(provider: AgentProvider, accountId: string | null, model: string): string {
  return `${provider}\u0000${accountId ?? ""}\u0000${model}`;
}

/** The latest future reset among the spent windows of a reading, in epoch seconds. */
function spentWindowReset(usage: AccountUsage): number | null {
  const now = Date.now() / 1_000;
  let latest: number | null = null;
  for (const limit of usage.limits) {
    for (const window of [limit.primary, limit.secondary]) {
      if (!window || window.usedPercent < 100 || window.resetsAt === null || window.resetsAt <= now) continue;
      latest = Math.max(latest ?? window.resetsAt, window.resetsAt);
    }
  }
  return latest;
}

export class UsageReadFailed extends Schema.TaggedError<UsageReadFailed>()("UsageReadFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toUsageReadFailed } = causeHelpers(UsageReadFailed);
