import type {
  AccountUsage,
  AccountUsageLimit,
  AgentStatus,
  ClientAgentSummary,
  HostProviderAccounts,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { type Accessor, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { createScopeGuard } from "../../scope-lifetime";

// A joined server gives the accounts of its providers on `provider-accounts-v1` routes. The released
// status, agent and usage routes never carry an account, so the client adds them from these.

/** The status with the accounts of each provider that can hold more than one. */
export function withHostAccounts(status: AgentStatus, host: HostProviderAccounts | null): AgentStatus {
  if (!host || !status.providers) return status;
  const accounts = new Map(host.providers.map((row) => [row.provider, row.accounts]));
  return {
    ...status,
    providers: status.providers.map((row) => {
      const rows = accounts.get(row.id);
      return rows ? { ...row, accounts: rows } : row;
    }),
  };
}

/** The account of a joined server's agent. Undefined is the provider's own sign-in. */
function hostAgentAccount(host: HostProviderAccounts, agentId: string): string | undefined {
  return host.agents.find((agent) => agent.agentId === agentId)?.accountId;
}

export function withHostAgentAccount(agent: ClientAgentSummary, host: HostProviderAccounts | null): ClientAgentSummary {
  if (!host) return agent;
  const accountId = hostAgentAccount(host, agent.id);
  if (accountId === agent.providerAccountId) return agent;
  const { providerAccountId: _released, ...rest } = agent;
  return accountId ? { ...rest, providerAccountId: accountId } : rest;
}

/** The profile with the account that the host now gives, or the profile itself when it did not change. */
export function withHostProfileAccount(profile: AgentProfile, host: HostProviderAccounts): AgentProfile {
  const accountId = hostAgentAccount(host, profile.id);
  if (accountId === profile.providerAccountId) return profile;
  const { providerAccountId: _previous, ...rest } = profile;
  return accountId ? { ...rest, providerAccountId: accountId } : rest;
}

/**
 * The readings of the provider's own sign-ins with those of the accounts after the first. A reading
 * that has not come back yet stays absent, so the usage keeps showing that it loads.
 */
export function withHostAccountUsage(
  usage: AccountUsage | null,
  accountLimits: readonly AccountUsageLimit[],
): AccountUsage | null {
  if (!usage || accountLimits.length === 0) return usage;
  return { limits: [...usage.limits.filter((limit) => limit.accountId === undefined), ...accountLimits] };
}

/** Whether an account is connected in `next` and was not in `previous`. */
function newlyConnected(previous: HostProviderAccounts, next: HostProviderAccounts): boolean {
  const connected = (host: HostProviderAccounts) =>
    host.providers.flatMap((row) =>
      row.accounts
        .filter((account) => account.state === "connected")
        .map((account) => `${row.provider}\n${account.id}`),
    );
  const before = new Set(connected(previous));
  return connected(next).some((key) => !before.has(key));
}

export interface HostAccountsSource {
  /** The joined server that serves `provider-accounts-v1` to this account, if any. */
  serverId: Accessor<string | undefined>;
  accounts: (serverId: string) => Promise<HostProviderAccounts>;
  usage: (serverId: string) => Promise<AccountUsage>;
  /** Runs after each list that the host gave, such as to put the accounts on the agents. */
  applied?: (host: HostProviderAccounts) => void;
}

/**
 * The accounts of a joined server's providers and their usage readings. Null and empty on a server
 * without `provider-accounts-v1`. A provider sign-in, an agent change and an account action can each
 * change the accounts, and none of them sends them, so the caller asks for a read again.
 */
export function createHostAccounts(source: HostAccountsSource) {
  const [host, setHost] = createSignal<HostProviderAccounts | null>(null);
  const [limits, setLimits] = createSignal<AccountUsageLimit[]>([]);
  const isCurrent = createScopeGuard();
  let generation = 0;
  let usageGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function refresh(): Promise<void> {
    clearTimeout(timer);
    const serverId = untrack(source.serverId);
    const request = ++generation;
    if (!serverId) {
      setHost(null);
      setLimits([]);
      return;
    }
    const next = await source.accounts(serverId);
    if (!isCurrent() || request !== generation) return;
    const previous = untrack(host);
    setHost(next);
    source.applied?.(next);
    // The rail shows an account only with a reading, and the host sends no reading after a sign-in.
    if (previous && newlyConnected(previous, next)) void refreshUsage().catch(() => undefined);
  }

  async function refreshUsage(): Promise<void> {
    const serverId = untrack(source.serverId);
    if (!serverId) return;
    // Two reads can run together, such as after an account action and after a new account connects.
    const request = ++usageGeneration;
    const usage = await source.usage(serverId);
    if (isCurrent() && request === usageGeneration && serverId === untrack(source.serverId)) setLimits(usage.limits);
  }

  /** Several changes often come together, such as the status and the agents after a sign-in. */
  function schedule(): void {
    if (!untrack(source.serverId)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh().catch(() => undefined), 1_000);
  }

  createEffect(source.serverId, () => {
    // The previous server's accounts must not show for this one while its request runs or after it fails.
    setHost(null);
    setLimits([]);
    void refresh().catch(() => undefined);
    void refreshUsage().catch(() => undefined);
  });
  onCleanup(() => clearTimeout(timer));

  return { host, limits, refresh, refreshUsage, schedule };
}
