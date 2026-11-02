import { Effect, Schema } from "effect";

class BillingEntitlementError extends Schema.TaggedError<BillingEntitlementError>()("BillingEntitlementError", {}) {}

import {
  BILLING_PLANS,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  LEGACY_MEMBER_LIMITS,
  memberLimitForPlan,
} from "@openbot/contracts/billing";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { OPEN_STATUSES_SQL } from "./billing-errors";

/** The statuses of a subscription that gives its plan or license now. */
const ENTITLED_STATUSES: readonly BillingSubscriptionStatus[] = ["active", "trialing", "past_due"];
const ENTITLED_STATUSES_SQL = `(${ENTITLED_STATUSES.map((status) => `'${status}'`).join(", ")})`;

export interface BillingEntitlement {
  plan: BillingPlanId;
  storageGb: number;
  /** The active members that the plan allows. A server made before the current limits keeps its legacy limit. */
  memberLimit: number;
  status: BillingSubscriptionStatus;
  /** Milliseconds since the epoch. */
  currentPeriodEnd: number | null;
  /** True for a hosted server. A self-hosted host can keep a plan from before the license. */
  hosted: boolean;
}

/**
 * The plan that a server can use now. Plan limits read only this function.
 * Only a subscription of the account that owns the server counts, so metadata that names another
 * account's server gives that server nothing. The owner comes from the Remote host, or from the hosted
 * server row, which exists before the server publishes its host.
 * A `past_due` subscription keeps its plan while Stripe retries the payment, until the end of the period
 * that the unpaid invoice is for. Stripe must cancel the subscription or mark it unpaid after the last
 * retry (docs/hosted-servers.md, Production), or the plan lasts for that whole period.
 */

export const getServerEntitlement = Effect.fn("Billing.getServerEntitlement")(function* (
  database: D1Database,
  serverId: string,
  now = Date.now(),
): Effect.fn.Return<BillingEntitlement | null, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT s.plan, s.status, s.current_period_end, hs.legacy_member_limits, hs.server_id IS NOT NULL AS hosted
         FROM billing_subscriptions s
       LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND h.owner_user_id = s.user_id
       LEFT JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.server_id = ? AND s.status IN ${ENTITLED_STATUSES_SQL}
         AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)
       ORDER BY s.updated_at DESC`,
        )
        .bind(serverId)
        .all<{
          plan: string;
          status: BillingSubscriptionStatus;
          current_period_end: number | null;
          legacy_member_limits: number | null;
          hosted: number;
        }>(),
    catch: () => new BillingEntitlementError({}),
  });
  for (const row of rows.results) {
    const plan = BILLING_PLANS.find((candidate) => candidate.id === row.plan);
    if (!plan) continue;
    if (!entitled(row, now)) continue;
    return {
      plan: plan.id,
      storageGb: plan.storageGb,
      memberLimit: memberLimit(plan.id, row.legacy_member_limits),
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      hosted: row.hosted === 1,
    };
  }
  return null;
});

/**
 * True when the account pays for a hosted server of any plan, so its license gets the bundle price. The
 * status and grace rules are the same as `getServerEntitlement`.
 */
export const accountHasServerPlan = Effect.fn("Billing.accountHasServerPlan")(function* (
  database: D1Database,
  userId: string,
  now = Date.now(),
): Effect.fn.Return<boolean, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT s.status, s.current_period_end FROM billing_subscriptions s
       JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.user_id = ? AND s.status IN ${ENTITLED_STATUSES_SQL}`,
        )
        .bind(userId)
        .all<{ status: BillingSubscriptionStatus; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  return rows.results.some((row) => entitled(row, now));
});

/** The open license of the account that owns a host. */
export interface OwnerLicense {
  ownerId: string;
  users: number;
  /** True when the license gives its users now, by the same rules as a server plan. */
  entitled: boolean;
}

/**
 * The open license of the account that owns a host, or null: the newest entitled one, else the newest
 * open one. An account has one open license, but a Dashboard change or a payment that no check could stop
 * can add a second. An open license that is not entitled, such as an `unpaid` one, still limits the people
 * of the owner's servers, but gives no seats.
 */
export const ownerLicenseForHost = Effect.fn("Billing.ownerLicenseForHost")(function* (
  database: D1Database,
  hostId: string,
  now = Date.now(),
): Effect.fn.Return<OwnerLicense | null, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT l.user_id AS owner_id, l.users, l.status, l.current_period_end FROM remote_hosts h
             JOIN licenses l ON l.user_id = h.owner_user_id AND l.status IN ${OPEN_STATUSES_SQL}
            WHERE h.host_id = ? ORDER BY l.updated_at DESC`,
        )
        .bind(hostId)
        .all<{ owner_id: string; users: number; status: string; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  const row = rows.results.find((license) => licenseEntitled(license, now)) ?? rows.results[0];
  if (!row) return null;
  return { ownerId: row.owner_id, users: row.users, entitled: licenseEntitled(row, now) };
});

/** True when a license gives its users at `now`, by the same rules as a server plan. */
export function licenseEntitled(license: { status: string; current_period_end: number | null }, now: number): boolean {
  const status = license.status;
  return (
    isOneOf(ENTITLED_STATUSES, status) && entitled({ status, current_period_end: license.current_period_end }, now)
  );
}

/** A `past_due` subscription counts only until the end of its period. */
function entitled(row: { status: BillingSubscriptionStatus; current_period_end: number | null }, now: number): boolean {
  return row.status !== "past_due" || (row.current_period_end !== null && row.current_period_end > now);
}

/** A server with no hosted row, or one made before the current plan limits, keeps its legacy limit. */
function memberLimit(plan: BillingPlanId, legacyMemberLimits: number | null): number {
  return legacyMemberLimits === 0 ? memberLimitForPlan(plan) : LEGACY_MEMBER_LIMITS[plan];
}

/**
 * The custom member limit of a server (one `?`: the server ID). As with `getServerEntitlement`, a row
 * applies only while its account owns the remote host or the hosted server.
 */
export const SERVER_MEMBER_LIMIT_SQL = `SELECT l.member_limit FROM server_member_limits l
  LEFT JOIN remote_hosts h ON h.host_id = l.server_id AND h.owner_user_id = l.owner_user_id
  LEFT JOIN hosted_servers hs ON hs.server_id = l.server_id AND hs.owner_user_id = l.owner_user_id
 WHERE l.server_id = ? AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)`;
