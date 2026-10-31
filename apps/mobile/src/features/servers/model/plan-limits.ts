import { agentProviderName, decodeHostProviderAccounts, isAccountUsage } from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import {
  type PlanLimitRow,
  type PlanLimits,
  type PlanLimitWindow,
  planLimitRows,
  planLimitWindowKind,
} from "@openbot/team-client/plan-limits";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useEffect, useMemo } from "react";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileText } from "@/shared/lib/text";

type Translate = MobileText["t"];

/** As on desktop: the host pushes the providers' own sign-ins, and the accounts after the first are read again. */
const PLAN_LIMITS_REFRESH_MS = 5 * 60_000;
const SAVED_FILE = "plan-limits-v1.json";

/** The last reading of each server, by account and server. Read on first use. */
let savedReadings: Map<string, PlanLimits> | null = null;

function savedKey(account: string, serverId: string): string {
  return JSON.stringify([account, serverId]);
}

/** The reading without the account emails and messages. The labels and the order name the rows. */
function withoutPersonalData(limits: PlanLimits): PlanLimits {
  return {
    usage: limits.usage,
    accounts:
      limits.accounts?.map((entry) => ({
        provider: entry.provider,
        accounts: entry.accounts.map((item) => ({ ...item, email: null, message: null })),
      })) ?? null,
  };
}

/** The saved entries a later launch can trust. Anything else is dropped. */
function decodeSavedReadings(value: unknown): [string, PlanLimits][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): [string, PlanLimits][] => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isAccountUsage(entry[1]?.usage)) return [];
    try {
      const accounts =
        entry[1].accounts === null ? null : decodeHostProviderAccounts({ providers: entry[1].accounts, agents: [] });
      return [[entry[0], { usage: entry[1].usage, accounts: accounts?.providers ?? null }]];
    } catch {
      return [];
    }
  });
}

function loadSavedReadings(): Map<string, PlanLimits> {
  if (savedReadings) return savedReadings;
  savedReadings = new Map();
  try {
    const file = new File(Paths.cache, SAVED_FILE);
    if (file.exists) savedReadings = new Map(decodeSavedReadings(JSON.parse(file.textSync())));
  } catch {
    // A damaged file costs the saved readings only. The next reading replaces it.
  }
  return savedReadings;
}

function saveReading(account: string, serverId: string, limits: PlanLimits): void {
  const saved = loadSavedReadings();
  const key = savedKey(account, serverId);
  const reading = withoutPersonalData(limits);
  if (JSON.stringify(saved.get(key)) === JSON.stringify(reading)) return;
  saved.set(key, reading);
  try {
    new File(Paths.cache, SAVED_FILE).writeSync(JSON.stringify([...saved]));
  } catch {
    // The reading stays in memory for this launch.
  }
}

/**
 * The limits of the server's providers. An owner or admin also gets the accounts after the first. While
 * the server is offline, the last reading stays, so the header button does not come and go with the
 * connection. The last usage is also kept on this phone, so the button shows at once when the app starts
 * or the server changes. The account emails are not kept: an account without a label shows its number until
 * the next reading.
 */
export function usePlanLimits(serverId: string) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const { session } = useMobileSession();
  const account = session ? `${session.apiUrl}:${session.user.id}` : null;
  const online = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === serverId)?.state === "online",
  );
  // Not in the key: the role check needs an online server, so the key would change when it goes offline.
  const accounts = useMobileWorkspaceSelector((current) => current.canManageProviderAccounts(serverId));
  const limits = useQuery({
    queryKey: queryKeys.planLimits(queryScope, serverId),
    queryFn: () => workspace.loadPlanLimits(serverId, accounts),
    enabled: online,
    initialData: () => (account ? loadSavedReadings().get(savedKey(account, serverId)) : undefined),
    // A saved reading is old: the server is read again as soon as it is online.
    initialDataUpdatedAt: 0,
    refetchInterval: PLAN_LIMITS_REFRESH_MS,
    retry: false,
  });
  const reading = limits.dataUpdatedAt > 0 ? limits.data : undefined;
  useEffect(() => {
    if (account && reading) saveReading(account, serverId, reading);
  }, [account, serverId, reading]);
  const rows = useMemo(() => planLimitRows(limits.data?.usage), [limits.data]);
  return { rows, accounts: limits.data?.accounts ?? null, online, loading: online && limits.isPending };
}

/** The provider, and the account when the provider has more than one. */
export function planLimitName(row: PlanLimitRow, accounts: PlanLimits["accounts"], t: Translate): string {
  const provider = agentProviderName(row.provider);
  const list = accounts?.find((entry) => entry.provider === row.provider)?.accounts ?? [];
  if (list.length < 2) return provider;
  const index = Math.max(
    0,
    list.findIndex((account) => account.id === (row.accountId ?? list[0]?.id)),
  );
  const account = list[index];
  const name =
    account?.label ||
    account?.email ||
    (account?.id === CLAUDE_API_KEY_ACCOUNT_ID
      ? t("mobile.agent.runtime.accountApiKey")
      : t("mobile.agent.runtime.accountNumbered", { number: index + 1 }));
  return `${provider} · ${name}`;
}

/** The rows with the least left first, as the header, the sheet and the Usage screen order them. */
export function lowestPlanLimitsFirst(rows: readonly PlanLimitRow[]): PlanLimitRow[] {
  return [...rows].sort((left, right) => left.remainingPercent - right.remainingPercent);
}

export const PLAN_LIMIT_RESET_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** When a window resets, or null when the host does not say. */
export function planLimitResetDate(window: PlanLimitWindow): Date | null {
  if (window.resetsAt === null) return null;
  const date = new Date(window.resetsAt * 1_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The identity of a window in a reading. Cursor reports two windows of the same length, so the position is part of it. */
export function planLimitWindowKey(window: PlanLimitWindow, index: number): string {
  return `${index}-${window.durationMins ?? "limit"}-${window.resetsAt ?? ""}`;
}

/** The name of a limit window, as desktop names it: 5-hour, Weekly, Monthly. */
export function planLimitWindowLabel(durationMins: number | null, t: Translate): string {
  const window = planLimitWindowKind(durationMins);
  switch (window.kind) {
    case "limit":
      return t("mobile.server.planLimits.window.limit");
    case "weekly":
      return t("mobile.server.planLimits.window.weekly");
    case "monthly":
      return t("mobile.server.planLimits.window.monthly");
    case "daily":
      return t("mobile.server.planLimits.window.daily");
    case "fiveHour":
      return t("mobile.server.planLimits.window.fiveHour");
    case "hours":
      return t("mobile.server.planLimits.window.hours", { count: window.hours });
    case "minutes":
      return t("mobile.server.planLimits.window.minutes", { minutes: window.minutes });
  }
}
