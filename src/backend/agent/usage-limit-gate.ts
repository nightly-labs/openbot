import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AccountUsage, AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Schema, Scope } from "effect";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import { agentProviderAccount as accountOf, providerForAgent } from "./thread-items";

export const USAGE_LIMIT_METHOD = "openbot/usageLimit";

const USAGE_LIMIT_RECHECK_MS = 15 * 60_000;

const RESET_GRACE_MS = 30_000;

const PROVIDER_FAILURE_HOLD_MS = 10 * 60_000;

const MAX_TIMER_MS = 2_147_483_647;

export interface UsageLimitHooks {
  emit(event: AgentEvent): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  readUsage(
    provider: AgentProvider,
    model: string,
    accountId: string | null,
  ): Effect.Effect<AccountUsage | null, UsageReadFailed>;
  held(agentIds: readonly string[]): Effect.Effect<void>;
  released(limit: UsageLimitKey): Effect.Effect<void>;
}

export interface UsageLimitGateOptions {
  store: AgentStore;
  hooks: UsageLimitHooks;
}

export interface UsageLimitKey {
  provider: AgentProvider;
  accountId: string | null;
  model: string;
}

interface ProviderFailure extends UsageLimitKey {
  endsAt: number;
  spent: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface UsageLimit extends UsageLimitKey {
  resetsAt: number | null;
  resetFromUsage: boolean;
  readBlind: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export class UsageLimitGate {
  readonly #store: AgentStore;
  readonly #hooks: UsageLimitHooks;
  readonly #limits = new Map<string, UsageLimit>();
  #scope = Scope.makeUnsafe();
  readonly #announced = new Set<AgentProvider>();
  readonly #failures = new Map<string, ProviderFailure>();
  readonly #tries = new Map<string, string>();
  readonly #readReleased = new Map<string, number>();

  constructor(options: UsageLimitGateOptions) {
    this.#store = options.store;
    this.#hooks = options.hooks;
  }

  mayDrain(agentId: string): boolean {
    const agent = this.#agent(agentId);
    return !agent || !this.#limits.has(limitKey(providerForAgent(agent), accountOf(agent), agent.model));
  }

  retry(agentId: string): void {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const key = limitKey(providerForAgent(agent), accountOf(agent), agent.model);
    if (this.#limits.has(key)) this.#tries.set(agentId, key);
  }

  chosen(agentId: string, limit: UsageLimitKey): void {
    const key = limitKey(limit.provider, limit.accountId, limit.model);
    if (this.#failures.has(key) && !this.#limits.has(key)) this.#tries.set(agentId, key);
  }

  passesOver(agentId: string): boolean {
    const agent = this.#agent(agentId);
    if (!agent) return false;
    const key = limitKey(providerForAgent(agent), accountOf(agent), agent.model);
    return this.#failures.has(key) && this.#tries.get(agentId) !== key;
  }

  mayTry(agentId: string): boolean {
    const agent = this.#agent(agentId);
    return (
      agent !== undefined &&
      this.#tries.get(agentId) === limitKey(providerForAgent(agent), accountOf(agent), agent.model)
    );
  }

  tryStarted(agentId: string): void {
    const agent = this.#agent(agentId);
    if (!agent || this.#tries.get(agentId) === limitKey(providerForAgent(agent), accountOf(agent), agent.model))
      this.#tries.delete(agentId);
  }

  isLimited(limit: UsageLimitKey): boolean {
    return this.#limits.has(limitKey(limit.provider, limit.accountId, limit.model));
  }

  failureKey(agentId: string, model: string | null = null): string | null {
    const agent = this.#agent(agentId);
    return agent ? limitKey(providerForAgent(agent), accountOf(agent), model ?? agent.model) : null;
  }

  isFailed(limit: UsageLimitKey): boolean {
    return this.#failures.has(limitKey(limit.provider, limit.accountId, limit.model));
  }

  isSpent(limit: UsageLimitKey): boolean {
    return this.#failures.get(limitKey(limit.provider, limit.accountId, limit.model))?.spent === true;
  }

  failed(agentId: string, model: string | null = null, resetDelayMs: number | null = null, spent = false): void {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const accountId = accountOf(agent);
    const turnModel = model ?? agent.model;
    const key = limitKey(provider, accountId, turnModel);
    if (this.#tries.get(agentId) === key) this.#tries.delete(agentId);
    const previous = this.#failures.get(key);
    if (previous) clearTimeout(previous.timer);
    const hold = Math.max(PROVIDER_FAILURE_HOLD_MS, (resetDelayMs ?? 0) + RESET_GRACE_MS);
    const endsAt = Math.max(previous?.endsAt ?? 0, Date.now() + hold);
    this.#failures.set(key, {
      provider,
      accountId,
      model: turnModel,
      endsAt,
      spent: spent || previous?.spent === true,
      timer: this.#armFailure(key, endsAt),
    });
    this.#hooks.emitRuntimeSnapshot();
  }

  #armFailure(key: string, endsAt: number): ReturnType<typeof setTimeout> {
    return setTimeout(
      () => {
        const failure = this.#failures.get(key);
        if (failure && failure.endsAt > Date.now()) failure.timer = this.#armFailure(key, failure.endsAt);
        else Effect.runFork(this.#releaseFailure(key).pipe(Effect.forkIn(this.#scope)));
      },
      Math.min(MAX_TIMER_MS, endsAt - Date.now()),
    );
  }

  limitedAgents(): NonNullable<AgentRuntimeSnapshot["usageLimits"]> {
    return this.#store.list().flatMap((agent) => {
      const limit = this.#limits.get(limitKey(providerForAgent(agent), accountOf(agent), agent.model));
      return limit ? [{ agentId: agent.id, resetsAt: limit.resetsAt }] : [];
    });
  }

  limitedModels(): NonNullable<AgentRuntimeSnapshot["usageLimitedModels"]> {
    return [...this.#limits.values()].slice(0, INPUT_LIMITS.agents).map((limit) => ({
      provider: limit.provider,
      model: limit.model,
      ...(limit.accountId ? { providerAccountId: limit.accountId } : {}),
    }));
  }

  failedModels(): NonNullable<AgentRuntimeSnapshot["failedModels"]> {
    return [...this.#failures.values()].slice(0, INPUT_LIMITS.agents).map((failure) => ({
      provider: failure.provider,
      model: failure.model,
      ...(failure.accountId ? { providerAccountId: failure.accountId } : {}),
    }));
  }

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
      readBlind: false,
      timer: null,
    };
    const future = (value: number | null) => (value !== null && value * 1_000 > Date.now() ? value : null);
    const named = future(resetsAt);
    limit.resetsAt = named ?? future(limit.resetsAt);
    if (named !== null) limit.resetFromUsage = false;
    const readReleased = this.#readReleased.get(key);
    this.#readReleased.delete(key);
    if (named !== null && readReleased !== undefined && readReleased * 1_000 > Date.now()) limit.readBlind = true;
    else if (limit.resetsAt === null) limit.readBlind = false;
    this.#limits.set(key, limit);
    this.#arm(key, limit);
    yield* this.#hooks.held(this.#heldAgents(limit).map((held) => held.id));
    this.#hooks.emitRuntimeSnapshot();
    if (limit.resetsAt !== null) {
      this.#announce(agentId, limit);
      return;
    }
    yield* this.#readReset(key, limit).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#limits.get(key) === limit) this.#announce(agentId, limit);
        }),
      ),
      Effect.forkIn(this.#scope),
    );
  }).bind(this);

  readonly completed = Effect.fn("UsageLimitGate.completed")(function* (
    this: UsageLimitGate,
    agentId: string,
    model: string | null = null,
  ) {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const key = limitKey(provider, accountOf(agent), model ?? agent.model);
    this.#readReleased.delete(key);
    if (this.#limits.has(key)) yield* this.#release(key);
    if (this.#failures.has(key)) yield* this.#releaseFailure(key);
    if (![...this.#limits.values()].some((limit) => limit.provider === provider)) this.#announced.delete(provider);
  }).bind(this);

  readonly accountReset = Effect.fn("UsageLimitGate.accountReset")(function* (
    this: UsageLimitGate,
    provider: AgentProvider,
    accountId: string | null,
  ) {
    const account = limitKey(provider, accountId, "");
    for (const key of [...this.#readReleased.keys()]) if (key.startsWith(account)) this.#readReleased.delete(key);
    for (const [key, limit] of [...this.#limits])
      if (limit.provider === provider && limit.accountId === accountId) yield* this.#release(key, true);
  }).bind(this);

  readonly dispose = Effect.fn("UsageLimitGate.dispose")(function* (this: UsageLimitGate) {
    for (const limit of this.#limits.values()) if (limit.timer) clearTimeout(limit.timer);
    this.#limits.clear();
    for (const failure of this.#failures.values()) clearTimeout(failure.timer);
    this.#failures.clear();
    this.#tries.clear();
    this.#readReleased.clear();
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
    const delay = limit.readBlind ? untilReset : Math.min(untilReset, USAGE_LIMIT_RECHECK_MS);
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
    if (limit.readBlind) {
      this.#arm(key, limit);
      return;
    }
    const known = limit.resetsAt;
    const named = limit.resetFromUsage ? null : known;
    const resetsAt = yield* this.#readReset(key, limit);
    if (this.#limits.get(key) !== limit || limit.timer !== null || typeof resetsAt === "number") return;
    if (resetsAt === null || known === null) {
      if (named !== null) this.#readReleased.set(key, named);
      yield* this.#release(key);
    } else this.#arm(key, limit);
  });

  readonly #readReset = Effect.fn("UsageLimitGate.readReset")(function* (
    this: UsageLimitGate,
    key: string,
    limit: UsageLimit,
  ) {
    const named = limit.resetFromUsage ? null : limit.resetsAt;
    const usage = yield* this.#hooks
      .readUsage(limit.provider, limit.model, limit.accountId)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (this.#limits.get(key) !== limit) return null;
    if (limit.resetsAt !== null && !limit.resetFromUsage && limit.resetsAt !== named) return limit.resetsAt;
    if (!usage?.limits.some((reading) => reading.primary || reading.secondary)) return undefined;
    const resetsAt = spentWindowReset(usage);
    if (resetsAt === null) return null;
    if (named !== null) {
      this.#arm(key, limit);
      return named;
    }
    const changed = limit.resetsAt !== resetsAt;
    limit.resetsAt = resetsAt;
    limit.resetFromUsage = true;
    this.#arm(key, limit);
    if (changed) this.#hooks.emitRuntimeSnapshot();
    return resetsAt;
  });

  readonly #release = Effect.fn("UsageLimitGate.release")(function* (this: UsageLimitGate, key: string, reset = false) {
    const limit = this.#limits.get(key);
    if (!limit) return;
    if (limit.timer) clearTimeout(limit.timer);
    this.#limits.delete(key);
    for (const [agentId, tryKey] of this.#tries) if (tryKey === key) this.#tries.delete(agentId);
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
    if (!this.#limits.has(key))
      for (const [agentId, tryKey] of this.#tries) if (tryKey === key) this.#tries.delete(agentId);
    this.#hooks.emitRuntimeSnapshot();
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
