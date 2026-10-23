import { Effect, Schema } from "effect";

class BillingEntitlementError extends Schema.TaggedError<BillingEntitlementError>()("BillingEntitlementError", {}) {}

import {
  BILLING_PLANS,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  memberLimitForPlan,
} from "@openbot/contracts/billing";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";

export interface BillingEntitlement {
  plan: BillingPlanId;
  storageGb: number;
  /** The active members that the plan allows. A Starter server made before the 1-member limit keeps 3. */
  memberLimit: number;
  status: BillingSubscriptionStatus;
  /** Milliseconds since the epoch. */
  currentPeriodEnd: number | null;
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
          `SELECT s.plan, s.status, s.current_period_end, hs.legacy_starter_members FROM billing_subscriptions s
       LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND h.owner_user_id = s.user_id
       LEFT JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.server_id = ? AND s.status IN ('active', 'trialing', 'past_due')
         AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)
       ORDER BY s.updated_at DESC`,
        )
        .bind(serverId)
        .all<{
          plan: string;
          status: BillingSubscriptionStatus;
          current_period_end: number | null;
          legacy_starter_members: number | null;
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
      memberLimit: memberLimit(plan.id, row.legacy_starter_members),
      status: row.status,
      currentPeriodEnd: row.current_period_end,
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
       WHERE s.user_id = ? AND s.status IN ('active', 'trialing', 'past_due')`,
        )
        .bind(userId)
        .all<{ status: BillingSubscriptionStatus; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  return rows.results.some((row) => entitled(row, now));
});

/** A `past_due` subscription counts only until the end of its period. */
function entitled(row: { status: BillingSubscriptionStatus; current_period_end: number | null }, now: number): boolean {
  return row.status !== "past_due" || (row.current_period_end !== null && row.current_period_end > now);
}

/** A Starter server with no hosted row, or one made before the 1-member limit, keeps the default limit. */
function memberLimit(plan: BillingPlanId, legacyStarterMembers: number | null): number {
  if (plan === "starter" && legacyStarterMembers !== 0) return DEFAULT_TEAM_MEMBER_LIMIT;
  return memberLimitForPlan(plan);
}
