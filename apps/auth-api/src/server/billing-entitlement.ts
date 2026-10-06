import { Effect, Schema } from "effect";

class BillingEntitlementError extends Schema.TaggedError<BillingEntitlementError>()("BillingEntitlementError", {}) {}

import { BILLING_PLANS, type BillingPlanId, type BillingSubscriptionStatus } from "@openbot/contracts/billing";

export interface BillingEntitlement {
  plan: BillingPlanId;
  storageGb: number;
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
          `SELECT s.plan, s.status, s.current_period_end FROM billing_subscriptions s
       LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND h.owner_user_id = s.user_id
       LEFT JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.server_id = ? AND s.status IN ('active', 'trialing', 'past_due')
         AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)
       ORDER BY s.updated_at DESC`,
        )
        .bind(serverId)
        .all<{ plan: string; status: BillingSubscriptionStatus; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  for (const row of rows.results) {
    const plan = BILLING_PLANS.find((candidate) => candidate.id === row.plan);
    if (!plan) continue;
    if (row.status === "past_due" && (row.current_period_end === null || row.current_period_end <= now)) continue;
    return { plan: plan.id, storageGb: plan.storageGb, status: row.status, currentPeriodEnd: row.current_period_end };
  }
  return null;
});
