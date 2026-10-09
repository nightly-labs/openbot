import { Effect, Schema } from "effect";
import { readBillingCohortCounts } from "./billing-cohorts";
import { BillingUsd } from "./billing-usd";
import { SalesAnalyticsDelivery, SalesAnalyticsDeliveryError } from "./sales-analytics-delivery";
import { STRIPE_API_VERSION } from "./stripe-client";

const STRIPE_API_ORIGIN = "https://api.stripe.com";
const STRIPE_TIMEOUT_MS = 10_000;
const KNOWN_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "trialing",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const StripeCoupon = Schema.Struct({
  amount_off: Schema.optional(Schema.NullOr(Schema.Int)),
  percent_off: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
});
const StripeDiscount = Schema.Struct({
  id: Schema.optional(Schema.String),
  start: Schema.optional(Schema.Int),
  end: Schema.optional(Schema.NullOr(Schema.Int)),
  coupon: Schema.optional(Schema.NullOr(StripeCoupon)),
  amount_off: Schema.optional(Schema.NullOr(Schema.Int)),
  percent_off: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
});
const StripePrice = Schema.Struct({
  currency: Schema.String,
  unit_amount: Schema.NullOr(Schema.Int),
  currency_options: Schema.optional(
    Schema.NullOr(
      Schema.Record(Schema.String, Schema.Struct({ unit_amount: Schema.optional(Schema.NullOr(Schema.Int)) })),
    ),
  ),
  recurring: Schema.optional(
    Schema.NullOr(Schema.Struct({ interval: Schema.String, interval_count: Schema.optional(Schema.Int) })),
  ),
});
const StripeSubscriptionItem = Schema.Struct({
  price: StripePrice,
  quantity: Schema.optional(Schema.NullOr(Schema.Int)),
  discounts: Schema.optional(Schema.NullOr(Schema.Array(StripeDiscount))),
});
const StripeSubscription = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  currency: Schema.String,
  cancel_at_period_end: Schema.Boolean,
  cancel_at: Schema.optional(Schema.NullOr(Schema.Int)),
  items: Schema.Struct({ data: Schema.Array(StripeSubscriptionItem) }),
  discounts: Schema.optional(Schema.NullOr(Schema.Array(StripeDiscount))),
});

type StripeDiscount = typeof StripeDiscount.Type;
type StripePrice = typeof StripePrice.Type;

const BILLING_SNAPSHOT_EVENT = "billing_snapshot" as const;

export class BillingSnapshotError extends Schema.TaggedError<BillingSnapshotError>()("BillingSnapshotError", {
  code: Schema.Literals(["database", "stripe", "invalid_subscription", "currency", "delivery", "invalid_input"]),
}) {}

export interface BillingSnapshotBindings {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  OPENPANEL_CLIENT_ID?: string;
  OPENPANEL_CLIENT_SECRET?: string;
}

export type BillingSnapshotFetch = (input: string, init: RequestInit) => Promise<Response>;

interface BillingSnapshotMetrics {
  mrr: number;
  arr: number;
  overdueMrr: number;
  payingAccounts: number;
  paidServers: number;
  cancellationsScheduled: number;
}

interface StoredSubscription {
  stripe_subscription_id: string;
  user_id: string;
  server_id: string | null;
}

interface SubscriptionSample {
  id: string;
  userId: string;
  serverId: string | null;
  status: "active" | "past_due";
  amountMinor: number;
  currency: string;
  interval: "month" | "year";
  cancelAtPeriodEnd: boolean;
}

interface StripeSubscriptionItem {
  price: StripePrice;
  quantity: number;
  discounts: readonly StripeDiscount[];
}

interface StripeSubscriptionSample {
  id: string;
  status: string;
  currency: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  interval: "month" | "year" | null;
  items: readonly StripeSubscriptionItem[];
  discounts: readonly StripeDiscount[];
}

/**
 * Takes a daily UTC sample of the current Stripe subscriptions that the account database knows.
 *
 * The source key is retained by SalesAnalyticsDelivery, so a five-minute cron can call this safely:
 * one `billing_snapshot:YYYY-MM-DD` event is accepted for each UTC day. Stripe remains the source of
 * the current subscription state; the D1 rows only provide the bounded list of known OpenBot IDs and
 * their account/server owners.
 */
export const captureBillingSnapshot = Effect.fn("captureBillingSnapshot")(function* (
  bindings: BillingSnapshotBindings,
  timestamp: number,
  fetcher: BillingSnapshotFetch = (input, init) => globalThis.fetch(input, init),
): Effect.fn.Return<void, BillingSnapshotError> {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) {
    return yield* new BillingSnapshotError({ code: "invalid_input" });
  }

  const secretKey = bindings.STRIPE_SECRET_KEY?.trim();
  const clientId = bindings.OPENPANEL_CLIENT_ID?.trim();
  const clientSecret = bindings.OPENPANEL_CLIENT_SECRET?.trim();
  // Test and development deployments do not have the production write credentials. They must not
  // call Stripe or create a partial ledger row in that case.
  if (!secretKey || !clientId || !clientSecret) return;

  const day = utcDay(timestamp);
  const sourceKey = billingSnapshotSourceKey(timestamp);
  const alreadyRecorded = yield* snapshotExists(bindings.DB, sourceKey).pipe(
    Effect.mapError(() => snapshotError("database")),
  );
  if (alreadyRecorded) return;

  const rows = yield* readKnownSubscriptions(bindings.DB).pipe(Effect.mapError(() => snapshotError("database")));
  const samples: SubscriptionSample[] = [];
  for (const row of rows) {
    const subscription = yield* readStripeSubscription(row.stripe_subscription_id, secretKey, fetcher).pipe(
      Effect.mapError(() => snapshotError("stripe")),
    );
    if (subscription.status !== "active" && subscription.status !== "past_due") {
      if (!KNOWN_STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status))
        return yield* new BillingSnapshotError({ code: "invalid_subscription" });
      continue;
    }
    if (subscription.id !== row.stripe_subscription_id)
      return yield* new BillingSnapshotError({ code: "invalid_subscription" });
    if (!subscription.interval) return yield* new BillingSnapshotError({ code: "invalid_subscription" });
    const amount = yield* subscriptionAmountAfterDiscount(subscription, timestamp);
    samples.push({
      id: subscription.id,
      userId: row.user_id,
      serverId: row.server_id,
      status: subscription.status,
      amountMinor: amount.amountMinor,
      currency: subscription.currency,
      interval: subscription.interval,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || subscription.cancelAt !== null,
    });
  }

  const billingUsd = new BillingUsd({ database: bindings.DB, fetch: fetcher });
  let metrics: BillingSnapshotMetrics = {
    mrr: 0,
    arr: 0,
    overdueMrr: 0,
    payingAccounts: 0,
    paidServers: 0,
    cancellationsScheduled: 0,
  };
  const users = new Set<string>();
  const servers = new Set<string>();
  for (const sample of samples) {
    if (!isBillingUsdCurrency(sample.currency)) return yield* new BillingSnapshotError({ code: "currency" });
    const converted = yield* billingUsd
      .convert(sample.amountMinor, sample.currency, timestamp)
      .pipe(Effect.mapError(() => snapshotError("currency")));
    if (!Number.isSafeInteger(converted.amountUsd) || converted.amountUsd < 0)
      return yield* new BillingSnapshotError({ code: "currency" });
    try {
      const monthly = sample.interval === "year" ? divideMonthly(converted.amountUsd) : converted.amountUsd;
      metrics = {
        ...metrics,
        mrr: addSafe(metrics.mrr, monthly),
        overdueMrr: addSafe(metrics.overdueMrr, sample.status === "past_due" ? monthly : 0),
        cancellationsScheduled: addSafe(metrics.cancellationsScheduled, sample.cancelAtPeriodEnd ? 1 : 0),
      };
    } catch (error) {
      return yield* error instanceof BillingSnapshotError ? error : snapshotError("invalid_subscription");
    }
    if (sample.amountMinor > 0) {
      users.add(sample.userId);
      if (sample.serverId) servers.add(sample.serverId);
    }
  }
  try {
    metrics = { ...metrics, arr: multiplySafe(metrics.mrr, 12), payingAccounts: users.size, paidServers: servers.size };
  } catch (error) {
    return yield* error instanceof BillingSnapshotError ? error : snapshotError("invalid_subscription");
  }
  const cohorts = yield* readBillingCohortCounts(bindings.DB, timestamp).pipe(
    Effect.mapError(() => snapshotError("database")),
  );

  const delivery = new SalesAnalyticsDelivery({
    database: bindings.DB,
    clientId,
    clientSecret,
    fetch: fetcher,
    now: () => timestamp,
  });
  yield* delivery
    .enqueue(
      sourceKey,
      null,
      BILLING_SNAPSHOT_EVENT,
      {
        snapshot_date: day,
        as_of: timestamp,
        reported_at: timestamp,
        currency: "usd",
        mrr: metrics.mrr,
        arr: metrics.arr,
        overdue_mrr: metrics.overdueMrr,
        paying_accounts: metrics.payingAccounts,
        paid_servers: metrics.paidServers,
        cancellations_scheduled: metrics.cancellationsScheduled,
        checkout_mature_accounts: cohorts.checkout_mature_accounts,
        checkout_converted_accounts: cohorts.checkout_converted_accounts,
        checkout_pending_accounts: cohorts.checkout_pending_accounts,
      },
      timestamp,
    )
    .pipe(
      Effect.mapError((error) =>
        error instanceof SalesAnalyticsDeliveryError
          ? new BillingSnapshotError({ code: "delivery" })
          : snapshotError("delivery"),
      ),
    );
});

/** Returns the UTC day used for the durable source key and the report's date dimension. */
function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** The stable key that makes the five-minute cron idempotent for one UTC day. */
function billingSnapshotSourceKey(timestamp: number): string {
  return `${BILLING_SNAPSHOT_EVENT}:${utcDay(timestamp)}`;
}

function readKnownSubscriptions(database: D1Database): Effect.Effect<StoredSubscription[], unknown> {
  return Effect.tryPromise({
    try: async () =>
      (
        await database
          .prepare(
            `SELECT stripe_subscription_id, user_id, server_id
               FROM billing_subscriptions
              ORDER BY stripe_subscription_id`,
          )
          .all<StoredSubscription>()
      ).results,
    catch: () => new Error("database"),
  });
}

function snapshotExists(database: D1Database, sourceKey: string): Effect.Effect<boolean, unknown> {
  return Effect.tryPromise({
    try: async () =>
      (await database
        .prepare("SELECT 1 AS present FROM billing_analytics_events WHERE source_key = ?")
        .bind(sourceKey)
        .first()) !== null,
    catch: () => new Error("database"),
  });
}

function readStripeSubscription(
  subscriptionId: string,
  secretKey: string,
  fetcher: BillingSnapshotFetch,
): Effect.Effect<StripeSubscriptionSample, BillingSnapshotError> {
  return Effect.gen(function* () {
    const query = new URLSearchParams();
    for (const expand of ["items.data.price.currency_options", "discounts", "items.data.discounts"])
      query.append("expand[]", expand);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(`${STRIPE_API_ORIGIN}/v1/subscriptions/${encodeURIComponent(subscriptionId)}?${query}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_API_VERSION },
          signal: AbortSignal.any([signal, AbortSignal.timeout(STRIPE_TIMEOUT_MS)]),
        }),
      catch: () => snapshotError("stripe"),
    });
    if (!response.ok) return yield* snapshotError("stripe");
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => snapshotError("stripe"),
    });
    return yield* decodeStripeSubscription(body);
  });
}

function decodeStripeSubscription(value: unknown): Effect.Effect<StripeSubscriptionSample, BillingSnapshotError> {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(StripeSubscription)(value).pipe(
      Effect.mapError(() => snapshotError("invalid_subscription")),
    );
    if (decoded.items.data.length === 0) return yield* snapshotError("invalid_subscription");
    const items: StripeSubscriptionItem[] = decoded.items.data.map((item) => ({
      price: item.price,
      quantity: item.quantity ?? 1,
      discounts: item.discounts ?? [],
    }));
    const interval = yield* inferInterval(items);
    return {
      id: decoded.id,
      status: decoded.status,
      currency: decoded.currency.toLowerCase(),
      cancelAtPeriodEnd: decoded.cancel_at_period_end,
      cancelAt: decoded.cancel_at ?? null,
      interval,
      items,
      discounts: decoded.discounts ?? [],
    };
  });
}

function inferInterval(
  items: readonly StripeSubscriptionItem[],
): Effect.Effect<"month" | "year" | null, BillingSnapshotError> {
  let result: "month" | "year" | null = null;
  let sawRecurring = false;
  for (const item of items) {
    const recurring = item.price.recurring;
    if (!recurring) continue;
    sawRecurring = true;
    const interval = recurring.interval;
    const count = recurring.interval_count ?? 1;
    if (count !== 1 || (interval !== "month" && interval !== "year"))
      return Effect.fail(new BillingSnapshotError({ code: "invalid_subscription" }));
    if (result && result !== interval) return Effect.fail(new BillingSnapshotError({ code: "invalid_subscription" }));
    result = interval;
  }
  return Effect.succeed(sawRecurring ? result : null);
}

function subscriptionAmountAfterDiscount(
  subscription: StripeSubscriptionSample,
  timestamp: number,
): Effect.Effect<{ amountMinor: number }, BillingSnapshotError> {
  return Effect.try({
    try: () => {
      let subtotal = 0;
      const appliedDiscounts = new Set<string>();
      for (const item of subscription.items) {
        const amount = priceAmount(item.price, subscription.currency, item.quantity);
        const discounted = applyDiscounts(amount, item.discounts, subscription.currency, timestamp, appliedDiscounts);
        subtotal = addSafe(subtotal, discounted);
      }
      return {
        amountMinor: applyDiscounts(
          subtotal,
          subscription.discounts,
          subscription.currency,
          timestamp,
          appliedDiscounts,
        ),
      };
    },
    catch: (error) => (error instanceof BillingSnapshotError ? error : snapshotError("invalid_subscription")),
  });
}

function priceAmount(price: StripePrice, currency: string, quantity: number): number {
  const priceCurrency = price.currency.toLowerCase();
  const unitAmount =
    priceCurrency === currency ? price.unit_amount : (price.currency_options?.[currency]?.unit_amount ?? null);
  if (
    !priceCurrency ||
    unitAmount === null ||
    !Number.isSafeInteger(unitAmount) ||
    unitAmount < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  )
    throw new BillingSnapshotError({ code: "invalid_subscription" });
  return multiplySafe(unitAmount, quantity);
}

function applyDiscounts(
  amount: number,
  discounts: readonly StripeDiscount[],
  currency: string,
  timestamp: number,
  seen: Set<string>,
): number {
  let result = amount;
  for (const value of discounts) {
    const id = value.id ?? null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const start = value.start ?? null;
    const end = value.end ?? null;
    const seconds = Math.floor(timestamp / 1_000);
    if ((start !== null && start > seconds) || (end !== null && end <= seconds)) continue;
    const coupon = value.coupon ?? value;
    const percentOff = coupon.percent_off ?? null;
    const amountOff = coupon.amount_off ?? null;
    if (percentOff !== null) {
      if (percentOff < 0 || percentOff > 100) throw new BillingSnapshotError({ code: "invalid_subscription" });
      result = Math.max(0, Math.round((result * (100 - percentOff)) / 100));
      continue;
    }
    if (amountOff !== null) {
      const discountCurrency = coupon.currency?.toLowerCase() ?? null;
      if (discountCurrency && discountCurrency !== currency) throw new BillingSnapshotError({ code: "currency" });
      if (!Number.isSafeInteger(amountOff) || amountOff < 0)
        throw new BillingSnapshotError({ code: "invalid_subscription" });
      result = Math.max(0, result - amountOff);
      continue;
    }
    throw new BillingSnapshotError({ code: "invalid_subscription" });
  }
  return result;
}

function isBillingUsdCurrency(value: string): value is "eur" | "usd" | "pln" {
  return value === "eur" || value === "usd" || value === "pln";
}

function addSafe(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new BillingSnapshotError({ code: "invalid_subscription" });
  return value;
}

function multiplySafe(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) throw new BillingSnapshotError({ code: "invalid_subscription" });
  return value;
}

function divideMonthly(amount: number): number {
  const value = Math.round(amount / 12);
  if (!Number.isSafeInteger(value) || value < 0) throw new BillingSnapshotError({ code: "invalid_subscription" });
  return value;
}

function snapshotError(code: BillingSnapshotError["code"]): BillingSnapshotError {
  return new BillingSnapshotError({ code });
}
