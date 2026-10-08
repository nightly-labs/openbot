import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageNamedWindow,
  type AccountUsageWindow,
  type AccountUsageWindowKind,
  type AgentProviderId,
  accountUsageCoversModel,
  agentProviderDescriptor,
  agentProviderName,
  isAgentProvider,
} from "@openbot/contracts/ipc";
import { currentText, type TextValue } from "../../text";

type UsageText = Pick<TextValue, "t" | "format">;

export type AccountUsageTone = "neutral" | "warning" | "critical";

/** One quota window under a provider in the usage list. */
export interface AccountUsageWindowRow {
  key: string;
  /** The window length, the provider's model name, or "Extra usage". */
  label: string;
  /** The window length of a model window, or the spend of an extra-usage window. */
  detail: string | null;
  remainingPercent: number;
  /** "Resets at 15:00" today, else "Resets Oct 9, 15:00". The list never cuts it short. */
  resetsAtLabel: string | null;
  tone: AccountUsageTone;
}

export interface AccountUsageCreditRow {
  key: string;
  label: string;
  value: string;
}

export interface AccountUsageProviderRow {
  provider: AgentProviderId;
  name: string;
  /** The tightest of `primary` and `secondary`: the reading the dock chip shows. */
  remainingPercent: number | null;
  windowLabel: string | null;
  resetsAtLabel: string | null;
  tone: AccountUsageTone;
  /** Every window the provider reported. Empty when it reported none. */
  windows: AccountUsageWindowRow[];
  credits: AccountUsageCreditRow[];
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
    windows: limit ? usageWindowRows(limit, text) : [],
    credits: limit ? usageCreditRows(limit, text) : [],
  };
}

const WINDOW_KIND_ORDER: Record<AccountUsageWindowKind, number> = { window: 0, model: 1, extra: 2 };

/**
 * Plan windows first, shortest first, then model windows in the provider's order, then extra usage.
 * A reading from an older host has no `windows`; its `primary` and `secondary` are the list.
 */
function usageWindowRows(limit: AccountUsageLimit, text: UsageText): AccountUsageWindowRow[] {
  const windows: AccountUsageNamedWindow[] =
    limit.windows ??
    [limit.primary, limit.secondary].flatMap((window) =>
      window ? [{ ...window, kind: "window" as const, label: null }] : [],
    );
  return windows
    .map((window, index) => ({ window, index }))
    .sort((left, right) => {
      const kind = WINDOW_KIND_ORDER[left.window.kind] - WINDOW_KIND_ORDER[right.window.kind];
      if (kind !== 0) return kind;
      if (left.window.kind === "window") {
        const duration =
          (left.window.windowDurationMins ?? Number.POSITIVE_INFINITY) -
          (right.window.windowDurationMins ?? Number.POSITIVE_INFINITY);
        if (duration !== 0 && !Number.isNaN(duration)) return duration;
      }
      return left.index - right.index;
    })
    .map(({ window, index }) => usageWindowRow(window, index, text));
}

function usageWindowRow(window: AccountUsageNamedWindow, index: number, text: UsageText): AccountUsageWindowRow {
  const { t, format } = text;
  const remainingPercent = usageRemainingPercent(window.usedPercent);
  const durationLabel = window.windowDurationMins === null ? null : usageWindowLabel(window.windowDurationMins, text);
  let label: string;
  let detail: string | null = null;
  if (window.kind === "extra") {
    label = window.label ?? t("account.usage.window.extra");
    const spent = window.spentUsd ?? null;
    const limit = window.limitUsd ?? null;
    if (spent !== null && limit !== null)
      detail = t("account.usage.window.spent", { spent: format.currencyUsd(spent), limit: format.currencyUsd(limit) });
    else if (spent !== null) detail = t("account.usage.window.spentOnly", { spent: format.currencyUsd(spent) });
  } else if (window.kind === "model" && window.label) {
    label = window.label;
    detail = durationLabel;
  } else {
    label = window.label ?? usageWindowLabel(window.windowDurationMins, text);
  }
  return {
    key: `${window.kind}:${index}`,
    label,
    detail,
    remainingPercent,
    resetsAtLabel: usageWindowReset(window.resetsAt, text),
    tone: usageTone(remainingPercent),
  };
}

/** A short reset time: the time alone when it is today, else the date and the time. */
export function usageWindowReset(
  resetsAt: number | null,
  text: UsageText = currentText(),
  now: Date = new Date(),
): string | null {
  if (resetsAt === null) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  const { t, format } = text;
  if (date.toDateString() === now.toDateString()) {
    return t("account.usage.window.resetsToday", {
      time: format.date(date, { hour: "numeric", minute: "2-digit" }),
    });
  }
  return t("account.usage.window.resets", {
    time: format.date(date, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  });
}

function usageCreditRows(limit: AccountUsageLimit, text: UsageText): AccountUsageCreditRow[] {
  const { t, format } = text;
  return (limit.credits ?? []).flatMap((credit, index) => {
    if (!credit.unlimited && credit.balance === null) return [];
    return [
      {
        key: `${credit.kind}:${index}`,
        label: t("account.usage.credits"),
        value: credit.unlimited
          ? t("account.usage.credits.unlimited")
          : format.number(credit.balance ?? 0, { maximumFractionDigits: 2 }),
      },
    ];
  });
}

/** What the usage list says for one window, for its accessible name. */
export function accountUsageWindowLabel(window: AccountUsageWindowRow, text: UsageText = currentText()): string {
  const { t } = text;
  const parts = [t("account.usage.row.left", { name: window.label, percent: window.remainingPercent })];
  if (window.detail) parts.push(window.detail);
  if (window.resetsAtLabel) parts.push(window.resetsAtLabel);
  return parts.join(", ");
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

export function accountUsageRowLabel(
  row: AccountUsageProviderRow,
  text: UsageText = currentText(),
  loading = false,
): string {
  const { t } = text;
  if (row.remainingPercent === null)
    return t(loading ? "account.usage.row.loading" : "account.usage.row.unavailable", { name: row.name });
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
