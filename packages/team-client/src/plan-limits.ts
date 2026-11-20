import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  type AgentProviderId,
  accountUsageCoversModel,
  agentProviderDescriptor,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  decodeUsageCredits,
  type HostProviderAccounts,
  isAccountUsage,
  isAgentProvider,
  keepUsageCredits,
  type UsageCredits,
  usageQuotaForModel,
  withUsageCredits,
} from "@openbot/contracts/ipc";
import { decodeRecord } from "@openbot/contracts/ipc-decoding";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { USAGE_CREDITS_ROUTES } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { Effect, Schema } from "effect";
import { listProviderAccounts, providerAccountUsage } from "./team-admin-requests";
import type { TeamApiRequest } from "./team-api-requests";

export type PlanLimitTone = "neutral" | "warning" | "critical";

export interface PlanLimitWindow {
  durationMins: number | null;
  remainingPercent: number;
  tone: PlanLimitTone;
  resetsAt: number | null;
}

export interface PlanLimitGroup {
  name: string;
  windowCount: number;
}

export interface PlanLimitListedWindow extends PlanLimitWindow {
  group: PlanLimitGroup | null;
}

export interface PlanLimitRow {
  provider: AgentProviderId;
  accountId: string | null;
  windows: readonly PlanLimitWindow[];
  listedWindows: readonly PlanLimitListedWindow[];
  remainingPercent: number;
  tone: PlanLimitTone;
}

export interface PlanLimits {
  usage: AccountUsage;
  accounts: HostProviderAccounts["providers"] | null;
}

export class PlanLimitsRequestError extends Schema.TaggedError<PlanLimitsRequestError>()("PlanLimitsRequestError", {
  cause: Schema.Defect(),
}) {}

export type PlanLimitWindowKind =
  | { kind: "limit" | "weekly" | "monthly" | "daily" | "fiveHour" }
  | { kind: "hours"; hours: number }
  | { kind: "minutes"; minutes: number };

export function planLimitWindowKind(durationMins: number | null): PlanLimitWindowKind {
  if (durationMins === null) return { kind: "limit" };
  if (nearDuration(durationMins, 10_080)) return { kind: "weekly" };
  if (nearDuration(durationMins, 43_200) || nearDuration(durationMins, 40_320)) return { kind: "monthly" };
  if (nearDuration(durationMins, 1_440)) return { kind: "daily" };
  if (nearDuration(durationMins, 300)) return { kind: "fiveHour" };
  if (durationMins >= 60 && durationMins % 60 === 0) return { kind: "hours", hours: durationMins / 60 };
  return { kind: "minutes", minutes: Math.round(durationMins) };
}

function nearDuration(durationMins: number, targetMins: number): boolean {
  return Math.abs(durationMins - targetMins) <= targetMins * 0.05;
}

export function usageRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.round(100 - usedPercent));
}

export function usageTone(remainingPercent: number | null): PlanLimitTone {
  if (remainingPercent === null || remainingPercent >= 30) return "neutral";
  return remainingPercent < 10 ? "critical" : "warning";
}

export function usagePaceRemainingPercent(
  durationMins: number | null,
  resetsAt: number | null,
  nowMs: number,
): number | null {
  if (durationMins === null || durationMins <= 0 || resetsAt === null) return null;
  const leftMins = (resetsAt * 1_000 - nowMs) / 60_000;
  if (!(leftMins > 0) || leftMins > durationMins * 1.05) return null;
  return Math.min(100, (leftMins / durationMins) * 100);
}

export function reportedUsageWindows(
  limit: Pick<AccountUsageLimit, "primary" | "secondary" | "tertiary">,
): AccountUsageWindow[] {
  return [limit.primary, limit.secondary, limit.tertiary]
    .filter((window): window is AccountUsageWindow => window != null)
    .sort(
      (left, right) =>
        (left.windowDurationMins ?? Number.POSITIVE_INFINITY) - (right.windowDurationMins ?? Number.POSITIVE_INFINITY),
    );
}

function planLimitWindow(window: AccountUsageWindow): PlanLimitWindow {
  const remainingPercent = usageRemainingPercent(window.usedPercent);
  return {
    durationMins: window.windowDurationMins,
    remainingPercent,
    tone: usageTone(remainingPercent),
    resetsAt: window.resetsAt,
  };
}

export function planLimitRows(usage: AccountUsage | null | undefined): PlanLimitRow[] {
  const rows: PlanLimitRow[] = [];
  for (const limit of usage?.limits ?? []) {
    if (!isAgentProvider(limit.id)) continue;
    const windows = reportedUsageWindows(limit).map(planLimitWindow);
    if (windows.length === 0) continue;
    const remainingPercent = Math.min(...windows.map((window) => window.remainingPercent));
    const groupWindows = (limit.groups ?? []).flatMap((group) => {
      const reported = reportedUsageWindows(group);
      return reported.map(
        (window): PlanLimitListedWindow => ({
          ...planLimitWindow(window),
          group: { name: group.name, windowCount: reported.length },
        }),
      );
    });
    rows.push({
      provider: limit.id,
      accountId: limit.accountId ?? null,
      windows,
      listedWindows: groupWindows.length > 0 ? groupWindows : windows.map((window) => ({ ...window, group: null })),
      remainingPercent,
      tone: usageTone(remainingPercent),
    });
  }
  return rows.sort(
    (left, right) =>
      agentProviderDescriptor(left.provider).pickerOrder - agentProviderDescriptor(right.provider).pickerOrder ||
      Number(left.accountId !== null) - Number(right.accountId !== null),
  );
}

export function withSignInUsage(current: AccountUsage | null | undefined, signIns: AccountUsage): AccountUsage {
  return {
    limits: [
      ...signIns.limits.filter((limit) => limit.accountId === undefined),
      ...(current?.limits ?? []).filter((limit) => limit.accountId !== undefined),
    ],
  };
}

function usageLimitKey(limit: AccountUsageLimit): string {
  return JSON.stringify([limit.id, limit.accountId ?? null]);
}

export function withUsageEvent(current: AccountUsage | null | undefined, event: AccountUsage): AccountUsage {
  if (event.limits.length === 0) return withSignInUsage(current, event);
  const limits = new Map((current?.limits ?? []).map((limit) => [usageLimitKey(limit), limit]));
  for (const limit of event.limits) {
    const kept = limits.get(usageLimitKey(limit));
    limits.set(
      usageLimitKey(limit),
      keepUsageCredits(
        kept,
        limit.primary || limit.secondary || !kept
          ? limit
          : { ...limit, primary: kept.primary, secondary: kept.secondary },
      ),
    );
  }
  return { limits: [...limits.values()] };
}

function decodeAccountUsage(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) throw new Error("The server returned invalid usage limits.");
  return value;
}

export function readUsageCredits(request: TeamApiRequest): Effect.Effect<UsageCredits[]> {
  return Effect.tryPromise(() =>
    request(
      "POST",
      USAGE_CREDITS_ROUTES.list,
      (value) => decodeUsageCredits(decodeRecord(value, "usage credits").accounts),
      {},
    ),
  ).pipe(Effect.orElseSucceed(() => []));
}

export const readPlanLimits = Effect.fn("TeamClient.readPlanLimits")(function* (
  request: TeamApiRequest,
  accounts: boolean,
  credits = false,
): Effect.fn.Return<PlanLimits, PlanLimitsRequestError> {
  const signIns = Effect.tryPromise({
    try: () => request("GET", TEAM_API_ROUTES.agents.usage, decodeAccountUsage),
    catch: (cause) => new PlanLimitsRequestError({ cause }),
  });
  const creditRows = credits ? readUsageCredits(request) : Effect.succeed([]);
  if (!accounts) {
    const [signInUsage, rows] = yield* Effect.all([signIns, creditRows], { concurrency: "unbounded" });
    return { usage: withUsageCredits(withSignInUsage(null, signInUsage), rows), accounts: null };
  }
  const [signInUsage, extra, rows] = yield* Effect.all(
    [
      signIns,
      Effect.all([providerAccountUsage(request), listProviderAccounts(request)], {
        concurrency: "unbounded",
      }).pipe(Effect.orElseSucceed(() => null)),
      creditRows,
    ],
    { concurrency: "unbounded" },
  );
  return {
    usage: withUsageCredits(withSignInUsage(extra?.[0], signInUsage), rows),
    accounts: extra?.[1].providers ?? null,
  };
});

export interface SpentUsageWindow {
  slot: "primary" | "secondary";
  window: AccountUsageWindow;
  covers: boolean;
  onCredits: boolean;
}

export function spentUsageWindow(
  limits: readonly AccountUsageLimit[] | undefined,
  provider: AgentProviderId,
  accountId: string,
  model: string | null | undefined,
  nowMs: number,
): SpentUsageWindow | null {
  for (const limit of limits ?? []) {
    if (limit.id !== provider || (limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) !== accountId) continue;
    const quota = usageQuotaForModel(limit, model);
    if (!quota) continue;
    let spent: SpentUsageWindow | null = null;
    for (const slot of ["primary", "secondary"] as const) {
      const window = quota[slot];
      if (!window || window.usedPercent < 100) continue;
      if (window.resetsAt !== null && window.resetsAt * 1_000 <= nowMs) continue;
      if (spent && (window.resetsAt ?? Number.POSITIVE_INFINITY) <= (spent.window.resetsAt ?? Number.POSITIVE_INFINITY))
        continue;
      spent = {
        slot,
        window,
        covers: quota !== limit || accountUsageCoversModel(provider, model),
        onCredits: limit.creditsAvailable === true,
      };
    }
    if (spent) return spent;
  }
  return null;
}
