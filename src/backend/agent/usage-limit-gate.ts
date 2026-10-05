import type { AccountUsage, AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { providerForAgent } from "./thread-items";

/** A provider client's report that the plan refused this turn, with the reset in epoch seconds when it gave one. */
export const USAGE_LIMIT_METHOD = "openbot/usageLimit";

/** How often a limit with no reported reset is read again. A usage read is one request, not a turn. */
export const USAGE_LIMIT_RECHECK_MS = 15 * 60_000;

/** Time after the reported reset before work starts again, so the provider's clock has passed it too. */
const RESET_GRACE_MS = 30_000;

/** The longest delay `setTimeout` keeps. A longer wait is armed again when it fires. */
const MAX_TIMER_MS = 2_147_483_647;

export interface UsageLimitHooks {
  emit(event: AgentEvent): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  /** The provider's usage reading for this model, or null when it gives none. */
  readUsage(provider: AgentProvider, model: string): Promise<AccountUsage | null>;
  /** The agents a limit now holds, each time a refused turn reports it. */
  held(agentIds: readonly string[]): void;
}

export interface UsageLimitGateOptions {
  store: AgentStore;
  hooks: UsageLimitHooks;
}

interface UsageLimit {
  provider: AgentProvider;
  model: string;
  /** Epoch seconds, or null while the provider has not said. */
  resetsAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The plan limits of the provider accounts, and the queues they hold.
 *
 * Owns one entry per provider and model whose last turn the plan refused. While an entry exists, no
 * agent on that provider and model starts a turn: its messages and routine runs stay queued instead
 * of failing one by one. A model is part of the key because a weekly window can cover one model
 * family only; an account-wide window costs each other model one refused, requeued turn.
 *
 * The entry ends at the reported reset, after a usage read that finds no spent window, or when a
 * turn on that provider and model completes. It is kept in memory only: after a restart the first
 * refused turn closes the gate again.
 */
export class UsageLimitGate {
  readonly #store: AgentStore;
  readonly #hooks: UsageLimitHooks;
  readonly #limits = new Map<string, UsageLimit>();
  /** Providers the user was told about in this limit, so a limit that closes again is not announced twice. */
  readonly #announced = new Set<AgentProvider>();

  constructor(options: UsageLimitGateOptions) {
    this.#store = options.store;
    this.#hooks = options.hooks;
  }

  mayDrain(agentId: string): boolean {
    const agent = this.#agent(agentId);
    return !agent || !this.#limits.has(limitKey(providerForAgent(agent), agent.model));
  }

  /** The agents whose queue a limit holds, for the runtime snapshot. */
  limitedAgents(): NonNullable<AgentRuntimeSnapshot["usageLimits"]> {
    return this.#store.list().flatMap((agent) => {
      const limit = this.#limits.get(limitKey(providerForAgent(agent), agent.model));
      return limit ? [{ agentId: agent.id, resetsAt: limit.resetsAt }] : [];
    });
  }

  /** The plan refused a turn of this agent. `resetsAt` is in epoch seconds. */
  reached(agentId: string, resetsAt: number | null): void {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const key = limitKey(provider, agent.model);
    const limit = this.#limits.get(key) ?? { provider, model: agent.model, resetsAt: null, timer: null };
    // A reset already past would release the queue at once into the same refusal.
    const future = (value: number | null) => (value !== null && value * 1_000 > Date.now() ? value : null);
    limit.resetsAt = future(resetsAt) ?? future(limit.resetsAt);
    this.#limits.set(key, limit);
    this.#arm(key, limit);
    this.#hooks.held(this.#heldAgents(limit).map((held) => held.id));
    this.#hooks.emitRuntimeSnapshot();
    if (limit.resetsAt !== null) {
      this.#announce(agentId, limit);
      return;
    }
    // A provider that names no reset in its refusal usually reports it in its usage reading.
    void this.#readReset(key, limit).finally(() => {
      if (this.#limits.get(key) === limit) this.#announce(agentId, limit);
    });
  }

  /** A turn of this agent completed, so its provider and model take turns again. */
  completed(agentId: string): void {
    const agent = this.#agent(agentId);
    if (!agent) return;
    const provider = providerForAgent(agent);
    const key = limitKey(provider, agent.model);
    if (this.#limits.has(key)) this.#release(key);
    if (![...this.#limits.values()].some((limit) => limit.provider === provider)) this.#announced.delete(provider);
  }

  dispose(): void {
    for (const limit of this.#limits.values()) if (limit.timer) clearTimeout(limit.timer);
    this.#limits.clear();
    this.#announced.clear();
  }

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
      agentCount: this.#store.list().filter((agent) => providerForAgent(agent) === limit.provider).length,
    });
  }

  #arm(key: string, limit: UsageLimit): void {
    if (limit.timer) clearTimeout(limit.timer);
    const delay =
      limit.resetsAt === null ? USAGE_LIMIT_RECHECK_MS : limit.resetsAt * 1_000 - Date.now() + RESET_GRACE_MS;
    limit.timer = setTimeout(() => void this.#fire(key, limit), Math.max(0, Math.min(delay, MAX_TIMER_MS)));
  }

  async #fire(key: string, limit: UsageLimit): Promise<void> {
    if (this.#limits.get(key) !== limit) return;
    limit.timer = null;
    if (limit.resetsAt !== null) {
      if (limit.resetsAt * 1_000 + RESET_GRACE_MS > Date.now()) this.#arm(key, limit);
      else this.#release(key);
      return;
    }
    // A reading that still shows a spent window gives the reset; anything else lets one turn try.
    if ((await this.#readReset(key, limit)) === null && this.#limits.get(key) === limit) this.#release(key);
  }

  /** Reads the reset of the spent window into `limit` and arms it. Null when the reading shows none. */
  async #readReset(key: string, limit: UsageLimit): Promise<number | null> {
    const usage = await this.#hooks.readUsage(limit.provider, limit.model).catch(() => null);
    const resetsAt = usage ? spentWindowReset(usage) : null;
    if (resetsAt === null || this.#limits.get(key) !== limit) return null;
    limit.resetsAt = resetsAt;
    this.#arm(key, limit);
    this.#hooks.emitRuntimeSnapshot();
    return resetsAt;
  }

  #release(key: string): void {
    const limit = this.#limits.get(key);
    if (!limit) return;
    if (limit.timer) clearTimeout(limit.timer);
    this.#limits.delete(key);
    this.#hooks.emitRuntimeSnapshot();
    for (const agent of this.#heldAgents(limit)) this.#hooks.scheduleDrain(agent.id);
  }

  #heldAgents(limit: UsageLimit) {
    return this.#store
      .list()
      .filter((agent) => providerForAgent(agent) === limit.provider && agent.model === limit.model);
  }
}

function limitKey(provider: AgentProvider, model: string): string {
  return `${provider}\u0000${model}`;
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
