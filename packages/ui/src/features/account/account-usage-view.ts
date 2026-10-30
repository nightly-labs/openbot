import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  type AgentProviderId,
  agentProviderDescriptor,
  agentProviderName,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  type ProviderAccountStatus,
} from "@openbot/contracts/ipc";
import {
  type PlanLimitTone,
  planLimitWindowKind,
  reportedUsageWindows,
  usageRemainingPercent,
  usageTone,
} from "@openbot/team-client/plan-limits";
import { isApiKeyAccount, providerAccountName } from "../../components/provider-accounts";
import { currentText, type TextValue } from "../../text";

type UsageText = Pick<TextValue, "t" | "format">;

export type AccountUsageTone = PlanLimitTone;

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
  /** The account after the first that the reading is for. Null for the provider's own sign-in. */
  accountId: string | null;
  /** The provider, and the account when the provider has more than one. */
  name: string;
  /** The window that stops work first. The dock chip shows it. */
  remainingPercent: number | null;
  tone: AccountUsageTone;
  /**
   * Every reported window, the shortest first, so a weekly limit does not hide the 5-hour one. For a
   * provider that names quota groups, the windows of each group in the provider's order.
   */
  windows: AccountUsageWindowRow[];
  /** The reading's own windows, the shortest first. The rail ring shows them, not the quota groups. */
  ringWindows: AccountUsageWindowRow[];
  /** `false` for a provider that has no usage reading, so a missing amount is not a failure. */
  reportsUsage: boolean;
  /** The provider whose plan quota this reading also counts, such as Grok for a merged Cursor plan. */
  sharedQuotaWith: AgentProviderId | null;
}

/**
 * One row per connected provider account. A limit the provider reported fills the remaining amount;
 * an available provider with no reading still appears, so the dock does not hide Claude or Grok.
 */
export function accountUsageProviderRows(
  usage: AccountUsage | null,
  providers?: ReadonlyArray<{ id: string; state: string; accounts?: readonly ProviderAccountStatus[] | undefined }>,
  text: UsageText = currentText(),
): AccountUsageProviderRow[] {
  const accountsOf = (provider: AgentProviderId) => {
    const accounts = providers?.find((candidate) => candidate.id === provider)?.accounts ?? [];
    return accounts.length > 1 ? accounts : [];
  };
  const rows = new Map<string, AccountUsageProviderRow>();
  for (const limit of usage?.limits ?? []) {
    if (!isAgentProvider(limit.id)) continue;
    const accountId = limit.accountId ?? null;
    rows.set(usageRowKey(limit.id, accountId), usageRow(limit.id, accountId, accountsOf(limit.id), limit, text));
  }
  for (const provider of providers ?? []) {
    if (!isAgentProvider(provider.id) || provider.state !== "available" || provider.id === "opencode") continue;
    const accounts = accountsOf(provider.id);
    const ids = accounts.length
      ? accounts.flatMap((account) =>
          account.id === DEFAULT_PROVIDER_ACCOUNT_ID
            ? [null]
            : account.state === "connected" && !isApiKeyAccount(account.id)
              ? [account.id]
              : [],
        )
      : [null];
    for (const accountId of ids) {
      if (!rows.has(usageRowKey(provider.id, accountId)))
        rows.set(usageRowKey(provider.id, accountId), usageRow(provider.id, accountId, accounts, null, text));
    }
  }
  const accountOrder = (row: AccountUsageProviderRow) =>
    accountsOf(row.provider).findIndex((account) => account.id === (row.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID));
  return [...rows.values()].sort(
    (left, right) =>
      agentProviderDescriptor(left.provider).pickerOrder - agentProviderDescriptor(right.provider).pickerOrder ||
      accountOrder(left) - accountOrder(right),
  );
}

function usageRowKey(provider: AgentProviderId, accountId: string | null): string {
  return `${provider}\u0000${accountId ?? ""}`;
}

/** The identity of a row across readings. A list keyed by it keeps its items when a reading builds new rows. */
export function accountUsageRowKey(row: AccountUsageProviderRow): string {
  return usageRowKey(row.provider, row.accountId);
}

function usageRow(
  provider: AgentProviderId,
  accountId: string | null,
  accounts: readonly ProviderAccountStatus[],
  limit: AccountUsageLimit | null,
  text: UsageText,
): AccountUsageProviderRow {
  const windowRow = (window: AccountUsageWindow, label: string): AccountUsageWindowRow => {
    const remainingPercent = usageRemainingPercent(window.usedPercent);
    return {
      label,
      remainingPercent,
      tone: usageTone(remainingPercent),
      resetsAt: window.resetsAt,
      resetsAtLabel: formatUsageReset(window.resetsAt, text),
    };
  };
  const ownWindows = (limit ? reportedUsageWindows(limit) : []).map((window) =>
    windowRow(
      window,
      // Cursor's two windows share one billing cycle and differ by the models they cover. One
      // window alone is the whole plan.
      provider === "cursor" && limit?.primary && limit.secondary
        ? text.t(window === limit?.primary ? "account.usage.window.cursorModels" : "account.usage.window.otherModels")
        : usageWindowLabel(window.windowDurationMins, text),
    ),
  );
  // Antigravity limits each group of models apart, such as Gemini 4 Argon: one line per group, by
  // Google's name. The ring stays on the reading's own windows, the "Gemini Models" group.
  const groups = limit?.groups ?? [];
  const windows =
    groups.length > 1
      ? groups.flatMap((group) => {
          const groupWindows = reportedUsageWindows(group);
          return groupWindows.map((window) =>
            windowRow(
              window,
              groupWindows.length > 1
                ? text.t("account.usage.window.group", {
                    group: group.name,
                    window: usageWindowLabel(window.windowDurationMins, text),
                  })
                : group.name,
            ),
          );
        })
      : ownWindows;
  // The shortest window comes first, so on a tie the shorter window stops work first.
  const binding = ownWindows.reduce<AccountUsageWindowRow | null>(
    (lowest, window) => (lowest === null || window.remainingPercent < lowest.remainingPercent ? window : lowest),
    null,
  );
  const remainingPercent = binding?.remainingPercent ?? null;
  return {
    provider,
    accountId,
    name: accounts.length
      ? `${agentProviderName(provider)} · ${providerAccountName(text.t, accounts, accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)}`
      : agentProviderName(provider),
    remainingPercent,
    tone: usageTone(remainingPercent),
    windows,
    ringWindows: ownWindows,
    reportsUsage: agentProviderDescriptor(provider).reportsUsage,
    sharedQuotaWith: limit?.sharedQuotaWith ?? null,
  };
}

export function usageWindowLabel(durationMins: number | null, text: UsageText = currentText()): string {
  const { t } = text;
  const window = planLimitWindowKind(durationMins);
  switch (window.kind) {
    case "limit":
      return t("account.usage.window.limit");
    case "weekly":
      return t("account.usage.window.weekly");
    case "monthly":
      return t("account.usage.window.monthly");
    case "daily":
      return t("account.usage.window.daily");
    case "fiveHour":
      return t("account.usage.window.fiveHour");
    case "hours":
      return t("account.usage.window.hours", { count: window.hours });
    case "minutes":
      return t("account.usage.window.minutes", { minutes: window.minutes });
  }
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
