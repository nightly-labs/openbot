import { licensePeriodAmount, licensePlanFromPrice } from "@openbot/contracts/license";
import { Effect, Schema } from "effect";
import { readBillingCohortCounts } from "./billing-cohorts";
import { BillingUsd } from "./billing-usd";
import { SalesAnalyticsDelivery, SalesAnalyticsDeliveryError } from "./sales-analytics-delivery";
import { isLicensePrice, STRIPE_API_VERSION } from "./stripe-client";

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
  lookup_key: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
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
/** Errors of one row that do not go away when the run is tried again. */
const PERMANENT_ROW_ERRORS: ReadonlySet<BillingSnapshotError["code"]> = new Set([
  "missing_subscription",
  "invalid_subscription",
  "currency",
]);

export class BillingSnapshotError extends Schema.TaggedError<BillingSnapshotError>()("BillingSnapshotError", {
  code: Schema.Literals([
    "database",
    "stripe",
    "missing_subscription",
    "invalid_subscription",
    "currency",
    "delivery",
    "invalid_input",
  ]),
}) {}

export interface BillingSnapshotBindings {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  OPENPANEL_CLIENT_ID?: string;
  OPENPANEL_CLIENT_SECRET?: string;
}

export type BillingSnapshotFetch = (input: string, init: RequestInit) => Promise<Response>;

interface BillingSnapshotMetrics {
  /** Server plans only. The name and meaning are older than the license, so they stay the same. */
  mrr: number;
  arr: number;
  overdueMrr: number;
  payingAccounts: number;
  paidServers: number;
  cancellationsScheduled: number;
  licenseMrr: number;
  licenseAccounts: number;
  licensedUsers: number;
}

interface StoredSubscription {
  stripe_subscription_id: string;
  user_id: string;
  server_id: string | null;
  product: "server" | "license";
}

interface SubscriptionSample {
  id: string;
  userId: string;
  serverId: string | null;
  product: "server" | "license";
  /** The sum of the item quantities. For a license, this is the number of users that the account pays for. */
  quantity: number;
  status: "active" | "past_due";
  amountMinor: number;
  currency: "eur" | "usd" | "pln";
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
 * their account/server owners. Rows whose stored status is terminal in Stripe are not read again.
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
  // A row that stays bad must not block every later snapshot, so it is counted and left out. A Stripe
  // failure that can pass still fails the run: the snapshot of a day is never corrected.
  const skipped: BillingSnapshotError[] = [];
  for (const row of rows) {
    const sample = yield* subscriptionSample(row, secretKey, fetcher, timestamp).pipe(
      Effect.catchIf(
        (error) => PERMANENT_ROW_ERRORS.has(error.code),
        (error) => {
          console.warn("billing snapshot: subscription skipped", {
            subscriptionId: row.stripe_subscription_id,
            code: error.code,
          });
          skipped.push(error);
          return Effect.succeed(null);
        },
      ),
    );
    if (sample) samples.push(sample);
  }
  // When every row is bad, the cause is more probably the Stripe key or the Stripe API than the rows.
  // A snapshot with no revenue would then stay for the day, so the run fails.
  const [firstSkip] = skipped;
  if (firstSkip && skipped.length === rows.length) return yield* firstSkip;

  const billingUsd = new BillingUsd({ database: bindings.DB, fetch: fetcher });
  let metrics: BillingSnapshotMetrics = {
    mrr: 0,
    arr: 0,
    overdueMrr: 0,
    payingAccounts: 0,
    paidServers: 0,
    cancellationsScheduled: 0,
    licenseMrr: 0,
    licenseAccounts: 0,
    licensedUsers: 0,
  };
  const users = new Set<string>();
  const servers = new Set<string>();
  const licenseUsers = new Set<string>();
  for (const sample of samples) {
    const converted = yield* billingUsd
      .convert(sample.amountMinor, sample.currency, timestamp)
      .pipe(Effect.mapError(() => snapshotError("currency")));
    if (!Number.isSafeInteger(converted.amountUsd) || converted.amountUsd < 0)
      return yield* new BillingSnapshotError({ code: "currency" });
    try {
      const monthly = sample.interval === "year" ? divideMonthly(converted.amountUsd) : converted.amountUsd;
      metrics =
        sample.product === "license"
          ? {
              ...metrics,
              licenseMrr: addSafe(metrics.licenseMrr, monthly),
              licensedUsers: addSafe(metrics.licensedUsers, sample.quantity),
            }
          : {
              ...metrics,
              mrr: addSafe(metrics.mrr, monthly),
              overdueMrr: addSafe(metrics.overdueMrr, sample.status === "past_due" ? monthly : 0),
              cancellationsScheduled: addSafe(metrics.cancellationsScheduled, sample.cancelAtPeriodEnd ? 1 : 0),
            };
    } catch (error) {
      return yield* error instanceof BillingSnapshotError ? error : snapshotError("invalid_subscription");
    }
    if (sample.amountMinor > 0) {
      if (sample.product === "license") licenseUsers.add(sample.userId);
      else users.add(sample.userId);
      if (sample.serverId) servers.add(sample.serverId);
    }
  }
  let totalMrr = 0;
  let totalArr = 0;
  try {
    metrics = {
      ...metrics,
      arr: multiplySafe(metrics.mrr, 12),
      payingAccounts: users.size,
      paidServers: servers.size,
      licenseAccounts: licenseUsers.size,
    };
    totalMrr = addSafe(metrics.mrr, metrics.licenseMrr);
    totalArr = multiplySafe(totalMrr, 12);
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
        license_mrr: metrics.licenseMrr,
        license_accounts: metrics.licenseAccounts,
        licensed_users: metrics.licensedUsers,
        total_mrr: totalMrr,
        total_arr: totalArr,
        checkout_mature_accounts: cohorts.checkout_mature_accounts,
        checkout_converted_accounts: cohorts.checkout_converted_accounts,
        checkout_pending_accounts: cohorts.checkout_pending_accounts,
        skipped_subscriptions: skipped.length,
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

/** Reads one stored subscription from Stripe. Returns null when it has no recurring revenue now. */
function subscriptionSample(
  row: StoredSubscription,
  secretKey: string,
  fetcher: BillingSnapshotFetch,
  timestamp: number,
): Effect.Effect<SubscriptionSample | null, BillingSnapshotError> {
  return Effect.gen(function* () {
    const subscription = yield* readStripeSubscription(row.stripe_subscription_id, secretKey, fetcher);
    if (subscription.status !== "active" && subscription.status !== "past_due") {
      if (!KNOWN_STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status))
        return yield* new BillingSnapshotError({ code: "invalid_subscription" });
      return null;
    }
    if (subscription.id !== row.stripe_subscription_id)
      return yield* new BillingSnapshotError({ code: "invalid_subscription" });
    if (!subscription.interval) return yield* new BillingSnapshotError({ code: "invalid_subscription" });
    if (!isBillingUsdCurrency(subscription.currency)) return yield* new BillingSnapshotError({ code: "currency" });
    const amount = yield* subscriptionAmountAfterDiscount(subscription, subscription.currency, row.product, timestamp);
    const quantity = yield* Effect.try({
      try: () =>
        productItems(subscription.items, row.product).reduce((total, item) => addSafe(total, item.quantity), 0),
      catch: () => snapshotError("invalid_subscription"),
    });
    return {
      id: subscription.id,
      userId: row.user_id,
      serverId: row.server_id,
      product: row.product,
      quantity,
      status: subscription.status,
      amountMinor: amount.amountMinor,
      currency: subscription.currency,
      interval: subscription.interval,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || subscription.cancelAt !== null,
    };
  });
}

/**
 * Stripe never moves a subscription out of these statuses, so the snapshot does not read them. License
 * rows are in their own table and have no server.
 */
function readKnownSubscriptions(database: D1Database): Effect.Effect<StoredSubscription[], unknown> {
  return Effect.tryPromise({
    try: async () => {
      const servers = await database
        .prepare(
          `SELECT stripe_subscription_id, user_id, server_id
             FROM billing_subscriptions
            WHERE status NOT IN ('canceled', 'incomplete_expired')
            ORDER BY stripe_subscription_id`,
        )
        .all<Omit<StoredSubscription, "product">>();
      const licenses = await database
        .prepare(
          `SELECT stripe_subscription_id, user_id, NULL AS server_id
             FROM licenses
            WHERE status NOT IN ('canceled', 'incomplete_expired')
            ORDER BY stripe_subscription_id`,
        )
        .all<Omit<StoredSubscription, "product">>();
      return [
        ...servers.results.map((row): StoredSubscription => ({ ...row, product: "server" })),
        ...licenses.results.map((row): StoredSubscription => ({ ...row, product: "license" })),
      ];
    },
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
    if (response.status === 404) return yield* snapshotError("missing_subscription");
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
  currency: "eur" | "usd" | "pln",
  product: StoredSubscription["product"],
  timestamp: number,
): Effect.Effect<{ amountMinor: number }, BillingSnapshotError> {
  return Effect.try({
    try: () => {
      let subtotal = 0;
      const appliedDiscounts = new Set<string>();
      for (const item of productItems(subscription.items, product)) {
        const amount =
          product === "license"
            ? licensePriceAmount(item.price, item.quantity, currency)
            : priceAmount(item.price, subscription.currency, item.quantity);
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

/**
 * The items of one product. A server order has a server item and a license item until its split moves the
 * license to its own subscription, so the server row does not count the license.
 */
function productItems(
  items: readonly StripeSubscriptionItem[],
  product: StoredSubscription["product"],
): StripeSubscriptionItem[] {
  return items.filter(
    (item) =>
      isLicensePrice({ lookup_key: item.price.lookup_key ?? null, metadata: item.price.metadata ?? {} }) ===
      (product === "license"),
  );
}

/**
 * The Team license price is graduated tiers, so Stripe sends no `unit_amount` for it, and a subscription
 * cannot expand the tiers of another currency. The license service uses the same list price of the plan.
 * The amount is for the period of the Price; the caller divides a year.
 */
function licensePriceAmount(price: StripePrice, quantity: number, currency: "eur" | "usd" | "pln"): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new BillingSnapshotError({ code: "invalid_subscription" });
  return licensePeriodAmount(
    licensePlanFromPrice({ lookup_key: price.lookup_key ?? null, metadata: price.metadata ?? {} }),
    quantity,
    currency,
  );
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
