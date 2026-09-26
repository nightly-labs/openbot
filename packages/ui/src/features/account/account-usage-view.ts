import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  type AgentProviderId,
  accountUsageCoversModel,
  agentProviderDescriptor,
  agentProviderName,
  isAgentProvider,
} from "@openbot/contracts/ipc";
import { currentText, type TextValue } from "../../text";

type UsageText = Pick<TextValue, "t" | "format">;

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
  text: UsageText = currentText(),
): AccountUsageProviderRow[] {
  const rows = new Map<AgentProviderId, AccountUsageProviderRow>();
  for (const limit of usage?.limits ?? []) {
    if (!isAgentProvider(limit.id)) continue;
    rows.set(limit.id, usageRow(limit.id, limit, text));
  }
  for (const provider of providers ?? []) {
    if (!isAgentProvider(provider.id) || provider.state !== "available" || rows.has(provider.id)) continue;
    if (provider.id === "opencode") continue;
    rows.set(provider.id, usageRow(provider.id, null, text));
  }
  return [...rows.values()].sort(
    (left, right) =>
      agentProviderDescriptor(left.provider).pickerOrder - agentProviderDescriptor(right.provider).pickerOrder,
  );
}

function usageRow(
  provider: AgentProviderId,
  limit: AccountUsageLimit | null,
  text: UsageText,
): AccountUsageProviderRow {
  const window = limit ? mostConstrainedWindow(limit) : null;
  const remainingPercent = window ? usageRemainingPercent(window.usedPercent) : null;
  return {
    provider,
    name: agentProviderName(provider),
    remainingPercent,
    windowLabel: window ? usageWindowLabel(window.windowDurationMins, text) : null,
    resetsAtLabel: window ? formatUsageReset(window.resetsAt, text) : null,
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
  model?: string | null,
): AccountUsageProviderRow | null {
  if (provider) {
    if (!accountUsageCoversModel(provider, model)) return null;
    return rows.find((row) => row.provider === provider) ?? null;
  }
  let lowest: AccountUsageProviderRow | null = null;
  for (const row of rows) {
    if (row.remainingPercent === null) continue;
    if (lowest === null || lowest.remainingPercent === null || row.remainingPercent < lowest.remainingPercent)
      lowest = row;
  }
  return lowest;
}

export function usageWindowLabel(durationMins: number | null, text: UsageText = currentText()): string {
  const { t } = text;
  if (durationMins === null) return t("account.usage.window.limit");
  if (nearDuration(durationMins, 10_080)) return t("account.usage.window.weekly");
  if (nearDuration(durationMins, 43_200) || nearDuration(durationMins, 40_320))
    return t("account.usage.window.monthly");
  if (nearDuration(durationMins, 1_440)) return t("account.usage.window.daily");
  if (nearDuration(durationMins, 300)) return t("account.usage.window.fiveHour");
  if (durationMins >= 60 && durationMins % 60 === 0) {
    return t("account.usage.window.hours", { count: durationMins / 60 });
  }
  return t("account.usage.window.minutes", { minutes: Math.round(durationMins) });
}

export function formatUsageReset(resetsAt: number | null, text: UsageText = currentText()): string | null {
  if (resetsAt === null) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return text.format.date(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function accountUsageRowLabel(row: AccountUsageProviderRow, text: UsageText = currentText()): string {
  const { t } = text;
  if (row.remainingPercent === null) return t("account.usage.row.unavailable", { name: row.name });
  const parts = [t("account.usage.row.left", { name: row.name, percent: row.remainingPercent })];
  if (row.windowLabel) parts.push(row.windowLabel);
  if (row.resetsAtLabel) parts.push(t("account.usage.row.resets", { time: row.resetsAtLabel }));
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
