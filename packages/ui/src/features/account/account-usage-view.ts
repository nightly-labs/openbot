import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  type AgentProviderId,
  agentProviderDescriptor,
  agentProviderName,
  isAgentProvider,
} from "@openbot/contracts/ipc";

export type AccountUsageTone = "neutral" | "warning" | "critical";

export interface AccountUsageProviderRow {
  provider: AgentProviderId;
  name: string;
  remainingPercent: number | null;
  windowLabel: string | null;
  resetsAtLabel: string | null;
  tone: AccountUsageTone;
}

/** Remaining quota from a provider-reported used percentage. */
export function usageRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.round(100 - usedPercent));
}

export function usageTone(remainingPercent: number | null): AccountUsageTone {
  if (remainingPercent === null || remainingPercent >= 30) return "neutral";
  return remainingPercent < 10 ? "critical" : "warning";
}

/**
 * One row per connected provider. A limit the provider reported fills the remaining amount; an
 * available provider with no reading still appears, so the dock does not hide Claude or Grok.
 */
export function accountUsageProviderRows(
  usage: AccountUsage | null,
  providers?: ReadonlyArray<{ id: string; state: string }>,
): AccountUsageProviderRow[] {
  const rows = new Map<AgentProviderId, AccountUsageProviderRow>();
  for (const limit of usage?.limits ?? []) {
    if (!isAgentProvider(limit.id)) continue;
    rows.set(limit.id, usageRow(limit.id, limit));
  }
  for (const provider of providers ?? []) {
    if (!isAgentProvider(provider.id) || provider.state !== "available" || rows.has(provider.id)) continue;
    if (provider.id === "opencode") continue;
    rows.set(provider.id, usageRow(provider.id, null));
  }
  return [...rows.values()].sort(
    (left, right) =>
      agentProviderDescriptor(left.provider).pickerOrder - agentProviderDescriptor(right.provider).pickerOrder,
  );
}

function usageRow(provider: AgentProviderId, limit: AccountUsageLimit | null): AccountUsageProviderRow {
  const window = limit ? mostConstrainedWindow(limit) : null;
  const remainingPercent = window ? usageRemainingPercent(window.usedPercent) : null;
  return {
    provider,
    name: agentProviderName(provider),
    remainingPercent,
    windowLabel: window ? usageWindowLabel(window.windowDurationMins) : null,
    resetsAtLabel: window ? formatUsageReset(window.resetsAt) : null,
    tone: usageTone(remainingPercent),
  };
}

/**
 * The row the dock chip shows. With an active agent it is that agent's provider only, so a spent
 * Grok quota does not show as the limit of a ChatGPT agent. With no agent it is the lowest row.
 */
export function accountUsageSummary(
  rows: AccountUsageProviderRow[],
  provider?: AgentProviderId | null,
): AccountUsageProviderRow | null {
  if (provider) return rows.find((row) => row.provider === provider) ?? null;
  let lowest: AccountUsageProviderRow | null = null;
  for (const row of rows) {
    if (row.remainingPercent === null) continue;
    if (lowest === null || lowest.remainingPercent === null || row.remainingPercent < lowest.remainingPercent)
      lowest = row;
  }
  return lowest;
}

export function usageWindowLabel(durationMins: number | null): string {
  if (durationMins === null) return "Limit";
  if (nearDuration(durationMins, 10_080)) return "Weekly";
  if (nearDuration(durationMins, 43_200) || nearDuration(durationMins, 40_320)) return "Monthly";
  if (nearDuration(durationMins, 1_440)) return "Daily";
  if (nearDuration(durationMins, 300)) return "5-hour";
  if (durationMins >= 60 && durationMins % 60 === 0) {
    const hours = durationMins / 60;
    return hours === 1 ? "1-hour" : `${hours}-hour`;
  }
  return `${Math.round(durationMins)} min`;
}

export function formatUsageReset(resetsAt: number | null): string | null {
  if (resetsAt === null) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function accountUsageRowLabel(row: AccountUsageProviderRow): string {
  if (row.remainingPercent === null) return `${row.name}, unavailable`;
  const parts = [`${row.name}, ${row.remainingPercent}% left`];
  if (row.windowLabel) parts.push(row.windowLabel);
  if (row.resetsAtLabel) parts.push(`resets ${row.resetsAtLabel}`);
  return parts.join(", ");
}

function mostConstrainedWindow(limit: AccountUsageLimit): AccountUsageWindow | null {
  const windows = [limit.primary, limit.secondary].filter((window): window is AccountUsageWindow => window !== null);
  if (windows.length === 0) return null;
  return windows.reduce((worst, window) => {
    if (window.usedPercent !== worst.usedPercent) return window.usedPercent > worst.usedPercent ? window : worst;
    const windowMins = window.windowDurationMins ?? Number.POSITIVE_INFINITY;
    const worstMins = worst.windowDurationMins ?? Number.POSITIVE_INFINITY;
    return windowMins < worstMins ? window : worst;
  });
}

function nearDuration(durationMins: number, targetMins: number): boolean {
  return Math.abs(durationMins - targetMins) <= targetMins * 0.05;
}
