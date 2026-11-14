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

function usageLimitKey(limit: AccountUsageLimit): string {
  return JSON.stringify([limit.id, limit.accountId ?? null]);
}

/**
 * The reading after a host's `usage-changed` event. The host sends one provider, or the providers it
 * has read so far, so each limit of the event replaces only its own, as on desktop. A limit with no
 * window keeps the windows it had, so its ring does not go and come back. An empty event clears the
 * provider's own sign-ins, as on desktop.
 */
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

/**
 * `usage-credits-v1`: whether each provider account of the host can work on credits. Optional: when
 * the read fails, the reading shows as it does from a host without it.
 */
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

/**
 * Reads the limits of the provider's own sign-ins, which every member can read. With `accounts`,
 * also reads the accounts after the first and their names: owners and admins only. With `credits`,
 * also reads whether each account can work on credits (`usage-credits-v1`). Those reads are
 * optional: when one fails, the sign-in limits still show, as they do for a member.
 */
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

/** A plan window that is spent and has not ended yet, as the composer notice and the model picker read it. */
export interface SpentUsageWindow {
  slot: "primary" | "secondary";
  window: AccountUsageWindow;
  /** False for a provider-level reading that does not limit the model (`accountUsageCoversModel`). */
  covers: boolean;
  /** The account keeps working on credits, so the spent window does not stop the model. */
  onCredits: boolean;
}

/**
 * The plan window of the account that stops the model now and resets last. Only the account's own reading
 * counts: another account of the same provider has its own quota. `usedPercent` is what the provider
 * reports, so it can pass 100 slightly. A window that ended gives the quota back, and its reading
 * stays as it was until something asks the provider again, so the clock is an input.
 */
export function spentUsageWindow(
  limits: readonly AccountUsageLimit[] | undefined,
  provider: AgentProviderId,
  accountId: string,
  model: string | null | undefined,
  nowMs: number,
): SpentUsageWindow | null {
  for (const limit of limits ?? []) {
    if (limit.id !== provider || (limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) !== accountId) continue;
    // A provider that names quota groups limits each group apart: only the model's group can stop it,
    // and a model that no group lists has no spent window.
    const quota = usageQuotaForModel(limit, model);
    if (!quota) continue;
    // When two windows are spent, the model can run only after both reset: keep the one that resets
    // last. A window with no reset time never gives the quota back.
    let spent: SpentUsageWindow | null = null;
    for (const slot of ["primary", "secondary"] as const) {
      const window = quota[slot];
      if (!window || window.usedPercent < 100) continue;
      if (window.resetsAt !== null && window.resetsAt * 1_000 <= nowMs) continue;
      if (spent && (window.resetsAt ?? Number.POSITIVE_INFINITY) <= (spent.window.resetsAt ?? Number.POSITIVE_INFINITY))
        continue;
      // A named group is the model's own quota.
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
