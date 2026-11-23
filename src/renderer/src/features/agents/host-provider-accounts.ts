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

export function withHostAccounts(status: AgentStatus, host: HostProviderAccounts | null): AgentStatus {
  if (!host || !status.providers) return status;
  const accounts = new Map(host.providers.map((row) => [row.provider, row.accounts]));
  const pools = new Map(host.pools?.map((row) => [row.provider, row.pool]));
  return {
    ...status,
    providers: status.providers.map((row) => {
      const rows = accounts.get(row.id);
      if (!rows) return row;
      const { accountPool: _released, liveVoiceAccount: _voice, ...rest } = row;
      const pool = pools.get(row.id);
      const liveVoiceAccount = row.id === "codex" ? host.liveVoiceAccount : null;
      return {
        ...rest,
        accounts: rows,
        ...(pool ? { accountPool: pool } : {}),
        ...(liveVoiceAccount ? { liveVoiceAccount } : {}),
      };
    }),
  };
}

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

export function withHostProfileAccount(profile: AgentProfile, host: HostProviderAccounts): AgentProfile {
  const accountId = hostAgentAccount(host, profile.id);
  if (accountId === profile.providerAccountId) return profile;
  const { providerAccountId: _previous, ...rest } = profile;
  return accountId ? { ...rest, providerAccountId: accountId } : rest;
}

export function withHostAccountUsage(
  usage: AccountUsage | null,
  accountLimits: readonly AccountUsageLimit[],
): AccountUsage | null {
  if (!usage || accountLimits.length === 0) return usage;
  return { limits: [...usage.limits.filter((limit) => limit.accountId === undefined), ...accountLimits] };
}

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
  serverId: Accessor<string | undefined>;
  accounts: (serverId: string) => Promise<HostProviderAccounts>;
  usage: (serverId: string) => Promise<AccountUsage>;
  applied?: (host: HostProviderAccounts) => void;
}

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
    if (previous && newlyConnected(previous, next)) void refreshUsage().catch(() => undefined);
  }

  async function refreshUsage(): Promise<void> {
    const serverId = untrack(source.serverId);
    if (!serverId) return;
    const request = ++usageGeneration;
    const usage = await source.usage(serverId);
    if (isCurrent() && request === usageGeneration && serverId === untrack(source.serverId)) setLimits(usage.limits);
  }

  function schedule(): void {
    if (!untrack(source.serverId)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh().catch(() => undefined), 1_000);
  }

  createEffect(source.serverId, () => {
    setHost(null);
    setLimits([]);
    void refresh().catch(() => undefined);
    void refreshUsage().catch(() => undefined);
  });
  onCleanup(() => clearTimeout(timer));

  return { host, limits, refresh, refreshUsage, schedule };
}
