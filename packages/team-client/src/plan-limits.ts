import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  type AgentProviderId,
  agentProviderDescriptor,
  type HostProviderAccounts,
  isAccountUsage,
  isAgentProvider,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect, Schema } from "effect";
import { listProviderAccounts, providerAccountUsage } from "./team-admin-requests";
import type { TeamApiRequest } from "./team-api-requests";

export type PlanLimitTone = "neutral" | "warning" | "critical";

/** One limit window that a provider reported, such as its 5-hour or its weekly window. */
export interface PlanLimitWindow {
  durationMins: number | null;
  remainingPercent: number;
  tone: PlanLimitTone;
  /** Unix seconds. */
  resetsAt: number | null;
}

/** The limits of one provider account that reported at least one window. */
export interface PlanLimitRow {
  provider: AgentProviderId;
  /** The account after the first that the reading is for. Null for the provider's own sign-in. */
  accountId: string | null;
  /** The shortest window first, so a weekly limit does not hide the 5-hour one. */
  windows: readonly PlanLimitWindow[];
  /** What is left of the window that stops work first. */
  remainingPercent: number;
  tone: PlanLimitTone;
}

/** The plan limits of a host, and the provider accounts that name the rows after the first. */
export interface PlanLimits {
  usage: AccountUsage;
  /** Null when the reader may not list the host's provider accounts. */
  accounts: HostProviderAccounts["providers"] | null;
}

export class PlanLimitsRequestError extends Schema.TaggedError<PlanLimitsRequestError>()("PlanLimitsRequestError", {
  cause: Schema.Defect(),
}) {}

/** The kind of a limit window, which names it: 5-hour, Weekly, 3-hour. */
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

/** Remaining quota from a provider-reported used percentage. */
export function usageRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.round(100 - usedPercent));
}

export function usageTone(remainingPercent: number | null): PlanLimitTone {
  if (remainingPercent === null || remainingPercent >= 30) return "neutral";
  return remainingPercent < 10 ? "critical" : "warning";
}

/** The windows of a reading, the shortest first. A window with no duration comes last. */
export function reportedUsageWindows(limit: Pick<AccountUsageLimit, "primary" | "secondary">): AccountUsageWindow[] {
  return [limit.primary, limit.secondary]
    .filter((window): window is AccountUsageWindow => window !== null)
    .sort(
      (left, right) =>
        (left.windowDurationMins ?? Number.POSITIVE_INFINITY) - (right.windowDurationMins ?? Number.POSITIVE_INFINITY),
    );
}

/** One row per provider account with a reported window, in the provider picker order. */
export function planLimitRows(usage: AccountUsage | null | undefined): PlanLimitRow[] {
  const rows: PlanLimitRow[] = [];
  for (const limit of usage?.limits ?? []) {
    if (!isAgentProvider(limit.id)) continue;
    const windows = reportedUsageWindows(limit).map((window): PlanLimitWindow => {
      const remainingPercent = usageRemainingPercent(window.usedPercent);
      return {
        durationMins: window.windowDurationMins,
        remainingPercent,
        tone: usageTone(remainingPercent),
        resetsAt: window.resetsAt,
      };
    });
    if (windows.length === 0) continue;
    // The shortest window comes first, so on a tie the shorter window stops work first.
    const remainingPercent = Math.min(...windows.map((window) => window.remainingPercent));
    rows.push({
      provider: limit.id,
      accountId: limit.accountId ?? null,
      windows,
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

/**
 * A new reading of the provider's own sign-ins, as the host's `usage-changed` event sends it. The
 * accounts after the first keep their readings: the host does not send them in the event.
 */
export function withSignInUsage(current: AccountUsage | null | undefined, signIns: AccountUsage): AccountUsage {
  return {
    limits: [
      ...signIns.limits.filter((limit) => limit.accountId === undefined),
      ...(current?.limits ?? []).filter((limit) => limit.accountId !== undefined),
    ],
  };
}

function decodeAccountUsage(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) throw new Error("The server returned invalid usage limits.");
  return value;
}

/**
 * Reads the limits of the provider's own sign-ins, which every member can read. With `accounts`,
 * also reads the accounts after the first and their names: owners and admins only. Those two reads
 * are optional: when one fails, the sign-in limits still show, as they do for a member.
 */
export const readPlanLimits = Effect.fn("TeamClient.readPlanLimits")(function* (
  request: TeamApiRequest,
  accounts: boolean,
): Effect.fn.Return<PlanLimits, PlanLimitsRequestError> {
  const signIns = Effect.tryPromise({
    try: () => request("GET", TEAM_API_ROUTES.agents.usage, decodeAccountUsage),
    catch: (cause) => new PlanLimitsRequestError({ cause }),
  });
  if (!accounts) return { usage: withSignInUsage(null, yield* signIns), accounts: null };
  const [signInUsage, extra] = yield* Effect.all(
    [
      signIns,
      Effect.all([providerAccountUsage(request), listProviderAccounts(request)], {
        concurrency: "unbounded",
      }).pipe(Effect.orElseSucceed(() => null)),
    ],
    { concurrency: "unbounded" },
  );
  return { usage: withSignInUsage(extra?.[0], signInUsage), accounts: extra?.[1].providers ?? null };
});
