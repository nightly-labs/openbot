import { Effect, Schema } from "effect";

const CONVERSION_WINDOW_MS = 7 * 24 * 60 * 60_000;

export class BillingCohortError extends Schema.TaggedError<BillingCohortError>()("BillingCohortError", {}) {}

export interface BillingCohortCounts {
  checkout_mature_accounts: number;
  checkout_converted_accounts: number;
  checkout_pending_accounts: number;
}

/** One cohort per account, starting with its first recorded checkout. */
export const readBillingCohortCounts = Effect.fn("BillingSales.cohorts")(function* (
  database: D1Database,
  timestamp: number,
): Effect.fn.Return<BillingCohortCounts, BillingCohortError> {
  const counts = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(`
      WITH starts AS (
        SELECT user_id, MIN(event_timestamp) AS started_at
        FROM billing_sales_facts
        WHERE fact_type = 'checkout_started' AND user_id IS NOT NULL AND event_timestamp <= ?1
        GROUP BY user_id
      ), cohorts AS (
        SELECT started_at, EXISTS (
          SELECT 1 FROM billing_sales_facts p
          WHERE p.user_id = s.user_id AND p.fact_type = 'payment_succeeded'
            AND json_extract(p.attributes_json, '$.paymentKind') = 'first_purchase'
            AND json_extract(p.attributes_json, '$.amount') > 0
            AND p.event_timestamp >= s.started_at
            AND p.event_timestamp <= s.started_at + ?2
            AND p.event_timestamp <= ?1
        ) AS converted
        FROM starts s
      )
      SELECT
        COUNT(CASE WHEN started_at <= ?1 - ?2 THEN 1 END) AS checkout_mature_accounts,
        COUNT(CASE WHEN started_at <= ?1 - ?2 AND converted THEN 1 END) AS checkout_converted_accounts,
        COUNT(CASE WHEN started_at > ?1 - ?2 THEN 1 END) AS checkout_pending_accounts
      FROM cohorts
    `)
        .bind(timestamp, CONVERSION_WINDOW_MS)
        .first<BillingCohortCounts>(),
    catch: () => new BillingCohortError({}),
  });
  if (!counts) return yield* new BillingCohortError({});
  return counts;
});
