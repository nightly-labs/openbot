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

/** One limit window that a provider reported, such as its 5-hour or its weekly window. */
export interface AccountUsageWindowRow {
  label: string;
  remainingPercent: number;
  tone: AccountUsageTone;
  /** Unix seconds. */
  resetsAt: number | null;
  resetsAtLabel: string | null;
}

export interface AccountUsageProviderRow {
  provider: AgentProviderId;
  name: string;
  /** The window that stops work first. The dock chip shows it. */
  remainingPercent: number | null;
  tone: AccountUsageTone;
  /** Every reported window, the shortest first, so a weekly limit does not hide the 5-hour one. */
  windows: AccountUsageWindowRow[];
  /** `false` for a provider that has no usage reading, so a missing amount is not a failure. */
  reportsUsage: boolean;
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
  const windows = (limit ? reportedWindows(limit) : []).map((window): AccountUsageWindowRow => {
    const remainingPercent = usageRemainingPercent(window.usedPercent);
    return {
      label: usageWindowLabel(window.windowDurationMins, text),
      remainingPercent,
      tone: usageTone(remainingPercent),
      resetsAt: window.resetsAt,
      resetsAtLabel: formatUsageReset(window.resetsAt, text),
    };
  });
  // The shortest window comes first, so on a tie the shorter window stops work first.
  const binding = windows.reduce<AccountUsageWindowRow | null>(
    (lowest, window) => (lowest === null || window.remainingPercent < lowest.remainingPercent ? window : lowest),
    null,
  );
  const remainingPercent = binding?.remainingPercent ?? null;
  return {
    provider,
    name: agentProviderName(provider),
    remainingPercent,
    tone: usageTone(remainingPercent),
    windows,
    reportsUsage: agentProviderDescriptor(provider).reportsUsage,
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

/** Time until a window resets, in short units: "38m", "1h 12m", "5d 2h". */
export function formatUsageResetIn(
  resetsAt: number | null,
  nowMs: number,
  text: UsageText = currentText(),
): string | null {
  if (resetsAt === null) return null;
  const remainingMs = resetsAt * 1_000 - nowMs;
  // A past reset means the reading is stale until the next refresh; show no countdown.
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return text.t("account.usage.resetIn.days", { days, hours });
  if (hours > 0) return text.t("account.usage.resetIn.hours", { hours, minutes });
  return text.t("account.usage.resetIn.minutes", { minutes });
}

export function accountUsageRowLabel(
  row: AccountUsageProviderRow,
  text: UsageText = currentText(),
  loading = false,
): string {
  const { t } = text;
  if (!row.reportsUsage) return t("account.usage.row.notReported", { name: row.name });
  if (row.remainingPercent === null)
    return t(loading ? "account.usage.row.loading" : "account.usage.row.unavailable", { name: row.name });
  const parts = [row.name];
  for (const window of row.windows) {
    parts.push(t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }));
    if (window.resetsAtLabel) parts.push(t("account.usage.row.resets", { time: window.resetsAtLabel }));
  }
  return parts.join(", ");
}

function reportedWindows(limit: AccountUsageLimit): AccountUsageWindow[] {
  return [limit.primary, limit.secondary]
    .filter((window): window is AccountUsageWindow => window !== null)
    .sort(
      (left, right) =>
        (left.windowDurationMins ?? Number.POSITIVE_INFINITY) - (right.windowDurationMins ?? Number.POSITIVE_INFINITY),
    );
}

function nearDuration(durationMins: number, targetMins: number): boolean {
  return Math.abs(durationMins - targetMins) <= targetMins * 0.05;
}
