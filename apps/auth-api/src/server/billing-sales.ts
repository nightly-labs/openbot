import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
} from "@openbot/contracts/billing";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { BillingUsd, BillingUsdError } from "./billing-usd";
import { SalesAnalyticsDelivery, SalesAnalyticsDeliveryError } from "./sales-analytics-delivery";
import type { StripeEvent } from "./stripe-client";

const CHECKOUT_LIFETIME_MS = 35 * 60_000;
const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const PENDING_BATCH_SIZE = 100;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_:-]{1,250}$/u;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,250}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9_.:/+-]{1,128}$/u;

export class BillingSalesError extends Schema.TaggedError<BillingSalesError>()("BillingSalesError", {
  code: Schema.Literals(["database", "invalid_input", "delivery", "currency"]),
}) {}

export interface BillingSalesOptions {
  database: D1Database;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  clientId: string | undefined;
  clientSecret: string | undefined;
  now?: () => number;
}

export interface BillingSalesCheckout {
  sessionId: string;
  returnToken: string;
  userId: string;
  serverId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  amount: number;
  /** The route only. It must be `/app...` or `/billing/return...`. */
  returnUrl: string;
  createdAt: number;
}

export interface BillingSalesSyncedSubscription {
  userId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
}

/** Used by the historical importer when payment action events already exist in OpenPanel. */
export interface BillingSalesWebhookOptions {
  suppressBillingAction?: boolean;
}

type FactType =
  | "checkout_started"
  | "checkout_completed"
  | "checkout_expired"
  | "checkout_returned"
  | "payment_failed"
  | "payment_succeeded";

interface FactRow {
  source_key: string;
  fact_type: FactType;
  source_id: string;
  invoice_id: string | null;
  session_id: string | null;
  user_id: string | null;
  server_id: string | null;
  event_timestamp: number;
  attributes_json: string;
}

interface FactAttributes {
  plan?: BillingPlanId;
  interval?: BillingInterval;
  currency?: BillingCurrency;
  amount?: number;
  paymentKind?: "first_purchase" | "renewal" | "adjustment";
  failureReason?: string;
  suppressBillingAction?: boolean;
}

interface CheckoutRow {
  session_id: string;
  user_id: string;
  server_id: string | null;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  amount: number;
  return_url: string;
  completed_at: number | null;
  returned_at: number | null;
}

/**
 * Records checkout and Stripe payment facts before they are sent to OpenPanel.
 *
 * This service does not call OpenPanel while a checkout or webhook is in flight. The immutable
 * facts are written first, and `processPending` later puts them in the durable delivery ledger.
 */
export class BillingSales {
  readonly #database: D1Database;
  readonly #now: () => number;
  readonly #fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly #delivery: SalesAnalyticsDelivery;

  constructor(options: BillingSalesOptions) {
    this.#database = options.database;
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch;
    this.#delivery = new SalesAnalyticsDelivery({
      database: options.database,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      fetch: options.fetch,
      now: this.#now,
    });
  }

  readonly checkout = Effect.fn("BillingSales.checkout")(function* (
    this: BillingSales,
    input: BillingSalesCheckout,
  ): Effect.fn.Return<void, BillingSalesError> {
    if (!validCheckout(input)) return yield* new BillingSalesError({ code: "invalid_input" });
    const tokenHash = yield* hashToken(input.returnToken);
    const createdAt = input.createdAt;
    const attributes = JSON.stringify({
      plan: input.plan,
      interval: input.interval,
      currency: input.currency,
      amount: input.amount,
    } satisfies FactAttributes);
    const sourceKey = `checkout:${input.sessionId}:started`;
    const expiresAt = createdAt + CHECKOUT_LIFETIME_MS;
    yield* d1(this.#database, () =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO billing_sales_checkouts(
                 session_id, return_token_hash, user_id, server_id, plan, interval, currency, amount,
                 return_url, created_at, expires_at, completed_at, expired_at, returned_at, subscription_id, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
          )
          .bind(
            input.sessionId,
            tokenHash,
            input.userId,
            input.serverId,
            input.plan,
            input.interval,
            input.currency,
            input.amount,
            input.returnUrl,
            createdAt,
            expiresAt,
            createdAt,
          ),
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO billing_sales_facts(
                 source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
                 event_timestamp, attributes_json, delivery_enqueued_at, created_at
               ) VALUES (?, 'checkout_started', ?, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            sourceKey,
            input.sessionId,
            input.sessionId,
            input.userId,
            input.serverId,
            createdAt,
            attributes,
            createdAt,
          ),
      ]),
    );
  }).bind(this);

  readonly webhook = Effect.fn("BillingSales.webhook")(function* (
    this: BillingSales,
    event: StripeEvent,
    synced: BillingSalesSyncedSubscription | null,
    options: BillingSalesWebhookOptions = {},
  ): Effect.fn.Return<void, BillingSalesError> {
    const eventTimestamp = stripeEventTimestamp(event, this.#now());
    if (!eventTimestamp) return yield* new BillingSalesError({ code: "invalid_input" });
    if (event.type === "checkout.session.completed") {
      yield* this.#checkoutCompleted(event, eventTimestamp);
      return;
    }
    if (event.type === "checkout.session.expired") {
      yield* this.#checkoutExpired(event, eventTimestamp);
      return;
    }
    if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") return;
    yield* this.#invoice(event, synced, eventTimestamp, options);
  }).bind(this);

  readonly returned = Effect.fn("BillingSales.returned")(function* (
    this: BillingSales,
    token: string,
  ): Effect.fn.Return<string | null, BillingSalesError> {
    if (!UUID_PATTERN.test(token)) return null;
    const tokenHash = yield* hashToken(token);
    const row = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT session_id, user_id, server_id, plan, interval, currency, amount, return_url,
                    completed_at, returned_at
               FROM billing_sales_checkouts
              WHERE return_token_hash = ?`,
        )
        .bind(tokenHash)
        .first<CheckoutRow>(),
    );
    if (!row) return null;
    if (row.completed_at !== null || row.returned_at !== null) return row.return_url;
    const now = this.#now();
    const attributes = JSON.stringify({
      plan: row.plan,
      interval: row.interval,
      currency: row.currency,
      amount: row.amount,
    } satisfies FactAttributes);
    // Keep the state update and immutable fact in one D1 transaction. A retry after a Worker
    // crash cannot leave returned_at set while losing the return fact.
    yield* d1(this.#database, () =>
      this.#database.batch([
        this.#database
          .prepare(
            `UPDATE billing_sales_checkouts
                  SET returned_at = ?, updated_at = ?
                WHERE return_token_hash = ? AND completed_at IS NULL AND returned_at IS NULL`,
          )
          .bind(now, now, tokenHash),
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO billing_sales_facts(
                 source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
                 event_timestamp, attributes_json, delivery_enqueued_at, created_at
               )
               SELECT ?, 'checkout_returned', session_id, NULL, session_id, user_id, server_id,
                      ?, ?, NULL, ?
                 FROM billing_sales_checkouts
                WHERE return_token_hash = ? AND completed_at IS NULL AND returned_at = ?`,
          )
          .bind(`checkout:${row.session_id}:returned`, now, attributes, now, tokenHash, now),
      ]),
    );
    return row.return_url;
  }).bind(this);

  readonly processPending = Effect.fn("BillingSales.processPending")(function* (
    this: BillingSales,
  ): Effect.fn.Return<void, BillingSalesError> {
    const rows = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
                    event_timestamp, attributes_json
               FROM billing_sales_facts
              WHERE delivery_enqueued_at IS NULL
              ORDER BY event_timestamp, source_key
              LIMIT ?`,
        )
        .bind(PENDING_BATCH_SIZE)
        .all<FactRow>(),
    );
    let failed = 0;
    for (const row of rows.results) {
      // An unknown account cannot receive a profile-scoped event. Tombstone it so one malformed
      // historical Stripe object cannot block the bounded queue forever.
      if (!validProfileId(row.user_id)) {
        yield* d1(this.#database, () =>
          this.#database
            .prepare("UPDATE billing_sales_facts SET delivery_enqueued_at = ? WHERE source_key = ?")
            .bind(this.#now(), row.source_key)
            .run(),
        );
        continue;
      }
      // A failed delivery or FX lookup leaves the fact pending for the next bounded cron run.
      const succeeded = yield* this.#emitFact(row).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (!succeeded) failed += 1;
    }
    if (failed > 0) console.warn("Billing sales pending facts remain queued.", { count: failed });
  }).bind(this);

  readonly #checkoutCompleted = Effect.fn("BillingSales.checkoutCompleted")(function* (
    this: BillingSales,
    event: StripeEvent,
    eventTimestamp: number,
  ): Effect.fn.Return<void, BillingSalesError> {
    const object = event.data.object;
    const sessionId = stringValue(object.id);
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return;
    const subscriptionId = stringValue(object.subscription);
    const row = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT session_id, user_id, server_id, plan, interval, currency, amount, return_url,
                    completed_at, returned_at
               FROM billing_sales_checkouts WHERE session_id = ?`,
        )
        .bind(sessionId)
        .first<CheckoutRow>(),
    );
    const metadata = recordValue(object.metadata);
    const userId = row?.user_id ?? safeId(metadata?.openbot_user_id);
    const serverId = row?.server_id ?? safeId(metadata?.openbot_server_id);
    if (row) {
      yield* d1(this.#database, () =>
        this.#database
          .prepare(
            `UPDATE billing_sales_checkouts
                  SET completed_at = COALESCE(completed_at, ?), subscription_id = COALESCE(subscription_id, ?), updated_at = ?
                WHERE session_id = ?`,
          )
          .bind(eventTimestamp, subscriptionId, this.#now(), sessionId)
          .run(),
      );
    }
    const attributes: FactAttributes = row
      ? { plan: row.plan, interval: row.interval, currency: row.currency, amount: row.amount }
      : {};
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO billing_sales_facts(
               source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
               event_timestamp, attributes_json, delivery_enqueued_at, created_at
               ) VALUES (?, 'checkout_completed', ?, NULL, ?, (SELECT id FROM users WHERE id = ?), ?, ?, ?, NULL, ?)`,
        )
        .bind(
          `checkout:${sessionId}:completed`,
          sessionId,
          sessionId,
          userId,
          serverId,
          eventTimestamp,
          JSON.stringify(attributes),
          this.#now(),
        )
        .run(),
    );
  }).bind(this);

  readonly #checkoutExpired = Effect.fn("BillingSales.checkoutExpired")(function* (
    this: BillingSales,
    event: StripeEvent,
    eventTimestamp: number,
  ): Effect.fn.Return<void, BillingSalesError> {
    const object = event.data.object;
    const sessionId = stringValue(object.id);
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return;
    const row = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT session_id, user_id, server_id, plan, interval, currency, amount, return_url,
                    completed_at, returned_at
               FROM billing_sales_checkouts WHERE session_id = ?`,
        )
        .bind(sessionId)
        .first<CheckoutRow>(),
    );
    const metadata = recordValue(object.metadata);
    const userId = row?.user_id ?? safeId(metadata?.openbot_user_id);
    const serverId = row?.server_id ?? safeId(metadata?.openbot_server_id);
    if (row) {
      yield* d1(this.#database, () =>
        this.#database
          .prepare(
            `UPDATE billing_sales_checkouts
                  SET expired_at = COALESCE(expired_at, ?), updated_at = ?
                WHERE session_id = ?`,
          )
          .bind(eventTimestamp, this.#now(), sessionId)
          .run(),
      );
    }
    const attributes: FactAttributes = row
      ? { plan: row.plan, interval: row.interval, currency: row.currency, amount: row.amount }
      : {};
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO billing_sales_facts(
               source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
               event_timestamp, attributes_json, delivery_enqueued_at, created_at
             ) VALUES (?, 'checkout_expired', ?, NULL, ?, (SELECT id FROM users WHERE id = ?), ?, ?, ?, NULL, ?)`,
        )
        .bind(
          `checkout:${sessionId}:expired`,
          sessionId,
          sessionId,
          userId,
          serverId,
          eventTimestamp,
          JSON.stringify(attributes),
          this.#now(),
        )
        .run(),
    );
  }).bind(this);

  readonly #invoice = Effect.fn("BillingSales.invoice")(function* (
    this: BillingSales,
    event: StripeEvent,
    synced: BillingSalesSyncedSubscription | null,
    eventTimestamp: number,
    options: BillingSalesWebhookOptions,
  ): Effect.fn.Return<void, BillingSalesError> {
    const object = event.data.object;
    const invoiceId = stringValue(object.id) ?? event.id;
    if (!INVOICE_ID_PATTERN.test(invoiceId)) return yield* new BillingSalesError({ code: "invalid_input" });
    const subscriptionId = invoiceSubscriptionId(object);
    const stored = subscriptionId
      ? yield* d1(this.#database, () =>
          this.#database
            .prepare(
              `SELECT user_id, server_id, plan, interval, currency
                   FROM billing_subscriptions WHERE stripe_subscription_id = ?`,
            )
            .bind(subscriptionId)
            .first<{
              user_id: string;
              server_id: string | null;
              plan: BillingPlanId;
              interval: BillingInterval;
              currency: BillingCurrency;
            }>(),
        )
      : null;
    const metadata = recordValue(object.metadata);
    const userId = synced?.userId ?? stored?.user_id ?? safeId(metadata?.openbot_user_id);
    const serverId = stored?.server_id ?? safeId(metadata?.openbot_server_id);
    const plan = synced?.plan ?? stored?.plan;
    const interval = synced?.interval ?? stored?.interval;
    const currency = billingCurrency(stringValue(object.currency)) ?? synced?.currency ?? stored?.currency;
    const amountValue = event.type === "invoice.paid" ? object.amount_paid : object.amount_due;
    const amount = isBillingAmount(amountValue) ? amountValue : null;
    const paymentKind = yield* this.#paymentKind(object.billing_reason, userId, eventTimestamp);
    const failureReason = event.type === "invoice.payment_failed" ? failureCode(object) : undefined;
    const attributes: FactAttributes = {
      ...(plan ? { plan } : {}),
      ...(interval ? { interval } : {}),
      ...(currency ? { currency } : {}),
      ...(amount !== null ? { amount } : {}),
      ...(paymentKind ? { paymentKind } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(options.suppressBillingAction ? { suppressBillingAction: true } : {}),
    };
    const failedAttemptKey =
      event.type === "invoice.payment_failed"
        ? positiveInteger(object.attempt_count)
          ? String(object.attempt_count)
          : event.id
        : null;
    const sourceKey =
      event.type === "invoice.paid" ? `invoice:${invoiceId}:paid` : `invoice:${invoiceId}:failed:${failedAttemptKey}`;
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO billing_sales_facts(
               source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
               event_timestamp, attributes_json, delivery_enqueued_at, created_at
             ) VALUES (?, ?, ?, ?, NULL, (SELECT id FROM users WHERE id = ?), ?, ?, ?, NULL, ?)`,
        )
        .bind(
          sourceKey,
          event.type === "invoice.paid" ? "payment_succeeded" : "payment_failed",
          event.id,
          invoiceId,
          userId,
          serverId,
          eventTimestamp,
          JSON.stringify(attributes),
          this.#now(),
        )
        .run(),
    );
  }).bind(this);

  readonly #paymentKind = Effect.fn("BillingSales.paymentKind")(function* (
    this: BillingSales,
    billingReason: unknown,
    userId: string | null,
    eventTimestamp: number,
  ): Effect.fn.Return<FactAttributes["paymentKind"], BillingSalesError> {
    if (billingReason === "subscription_create") return "first_purchase";
    if (billingReason === "subscription_cycle" || billingReason === "subscription_threshold") return "renewal";
    if (billingReason === "subscription_update" || billingReason === "manual") return "adjustment";
    if (!userId) return undefined;
    const previous = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT 1 AS seen FROM billing_sales_facts
              WHERE fact_type = 'payment_succeeded' AND user_id = ? AND event_timestamp < ? LIMIT 1`,
        )
        .bind(userId, eventTimestamp)
        .first<{ seen: number }>(),
    );
    return previous ? "renewal" : "first_purchase";
  }).bind(this);

  readonly #emitFact = Effect.fn("BillingSales.emitFact")(function* (
    this: BillingSales,
    row: FactRow,
  ): Effect.fn.Return<void, BillingSalesError> {
    const attributes = parseAttributes(row.attributes_json);
    if (!attributes) return yield* new BillingSalesError({ code: "invalid_input" });
    const profileId = validProfileId(row.user_id) ? row.user_id : null;
    const eventTimestamp = row.event_timestamp;
    // Checkout completion only links the Stripe session to its subscription. Stripe can emit it
    // before payment, and the delivery contract has no checkout_completed action. The durable
    // fact remains available for conversion queries; paid is emitted from invoice.paid only.
    if (row.fact_type === "checkout_completed") {
      yield* d1(this.#database, () =>
        this.#database
          .prepare(
            `UPDATE billing_sales_facts SET delivery_enqueued_at = ?
                WHERE source_key = ? AND delivery_enqueued_at IS NULL`,
          )
          .bind(this.#now(), row.source_key)
          .run(),
      );
      return;
    }
    const actionProperties = {
      ...(attributes.plan ? { plan: attributes.plan } : {}),
      ...(attributes.interval ? { interval: attributes.interval } : {}),
      ...(attributes.currency ? { currency: attributes.currency } : {}),
      ...(attributes.amount !== undefined ? { amount: attributes.amount } : {}),
    };
    if (row.fact_type === "payment_succeeded") {
      const recovery = yield* this.#recovery(row.invoice_id, profileId, eventTimestamp);
      if (!attributes.suppressBillingAction)
        yield* this.#enqueue(
          `billing:${row.source_key}`,
          profileId,
          "billing_action",
          { ...actionProperties, action: "payment_succeeded", ...(recovery ? { recovery } : {}) },
          eventTimestamp,
        );
      if (attributes.amount !== undefined && attributes.amount > 0 && attributes.currency) {
        const converted = yield* new BillingUsd({ database: this.#database, fetch: this.#fetch })
          .convert(attributes.amount, attributes.currency, eventTimestamp)
          .pipe(
            Effect.mapError((error) =>
              error instanceof BillingUsdError
                ? new BillingSalesError({ code: "currency" })
                : new BillingSalesError({ code: "currency" }),
            ),
          );
        if (!Number.isSafeInteger(converted.amountUsd) || converted.amountUsd <= 0)
          return yield* new BillingSalesError({ code: "currency" });
        yield* this.#enqueue(
          `revenue:${row.source_key}`,
          profileId,
          "revenue",
          {
            __revenue: converted.amountUsd,
            amount_usd: converted.amountUsd,
            original_amount: attributes.amount,
            currency: "usd",
            original_currency: attributes.currency,
            fx_rate: converted.fxRate,
            fx_date: converted.fxDate,
            ...(attributes.plan ? { plan: attributes.plan } : {}),
            ...(attributes.interval ? { interval: attributes.interval } : {}),
            payment_kind: attributes.paymentKind ?? "adjustment",
            ...(recovery ? { recovery } : {}),
          },
          eventTimestamp,
        );
      }
    } else {
      const eventName = "billing_action" as const;
      const eventProperties =
        row.fact_type === "checkout_started"
          ? { ...actionProperties, action: "checkout_started", checkout_status: "started" }
          : row.fact_type === "checkout_expired"
            ? { ...actionProperties, action: "checkout_expired", checkout_status: "expired" }
            : row.fact_type === "checkout_returned"
              ? { ...actionProperties, action: "checkout_returned", checkout_status: "returned" }
              : {
                  ...actionProperties,
                  action: "payment_failed",
                  ...(attributes.failureReason ? { failure_reason: attributes.failureReason } : {}),
                };
      yield* this.#enqueue(`billing:${row.source_key}`, profileId, eventName, eventProperties, eventTimestamp);
    }
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `UPDATE billing_sales_facts SET delivery_enqueued_at = ?
              WHERE source_key = ? AND delivery_enqueued_at IS NULL`,
        )
        .bind(this.#now(), row.source_key)
        .run(),
    );
  }).bind(this);

  readonly #recovery = Effect.fn("BillingSales.recovery")(function* (
    this: BillingSales,
    invoiceId: string | null,
    profileId: string | null,
    eventTimestamp: number,
  ): Effect.fn.Return<"invoice" | "checkout" | null, BillingSalesError> {
    const invoice = invoiceId
      ? yield* d1(this.#database, () =>
          this.#database
            .prepare(
              `SELECT 1 AS seen FROM billing_sales_facts
                  WHERE invoice_id = ? AND fact_type = 'payment_failed' AND event_timestamp <= ? LIMIT 1`,
            )
            .bind(invoiceId, eventTimestamp)
            .first<{ seen: number }>(),
        )
      : null;
    const checkout = profileId
      ? yield* d1(this.#database, () =>
          this.#database
            .prepare(
              `SELECT 1 AS seen FROM billing_sales_facts
                  WHERE user_id = ? AND fact_type IN ('checkout_expired', 'checkout_returned')
                    AND event_timestamp <= ? AND event_timestamp > ? LIMIT 1`,
            )
            .bind(profileId, eventTimestamp, eventTimestamp - RECOVERY_WINDOW_MS)
            .first<{ seen: number }>(),
        )
      : null;
    if (invoice && checkout) return "invoice";
    if (invoice) return "invoice";
    if (checkout) return "checkout";
    return null;
  }).bind(this);

  readonly #enqueue = Effect.fn("BillingSales.enqueue")(function* (
    this: BillingSales,
    sourceKey: string,
    profileId: string | null,
    name: "billing_action" | "revenue",
    properties: Record<string, string | number>,
    timestamp: number,
  ): Effect.fn.Return<void, BillingSalesError> {
    yield* this.#delivery
      .enqueue(sourceKey, profileId, name, properties, timestamp)
      .pipe(
        Effect.mapError((error) =>
          error instanceof SalesAnalyticsDeliveryError
            ? new BillingSalesError({ code: "delivery" })
            : new BillingSalesError({ code: "delivery" }),
        ),
      );
  }).bind(this);
}

function d1<A>(_database: D1Database, operation: () => Promise<A>): Effect.Effect<A, BillingSalesError> {
  return Effect.tryPromise({
    try: operation,
    catch: () => new BillingSalesError({ code: "database" }),
  });
}

function validCheckout(input: BillingSalesCheckout): boolean {
  return (
    SESSION_ID_PATTERN.test(input.sessionId) &&
    UUID_PATTERN.test(input.returnToken) &&
    input.userId.length > 0 &&
    input.userId.length <= 128 &&
    input.serverId.length > 0 &&
    input.serverId.length <= 128 &&
    isOneOf(BILLING_PLAN_IDS, input.plan) &&
    isOneOf(BILLING_INTERVALS, input.interval) &&
    isOneOf(BILLING_CURRENCIES, input.currency) &&
    isBillingAmount(input.amount) &&
    Number.isSafeInteger(input.createdAt) &&
    input.createdAt > 0 &&
    validReturnUrl(input.returnUrl)
  );
}

function validReturnUrl(value: string): boolean {
  if (!value || value.length > 1024 || hasControlCharacter(value)) return false;
  if (!value.startsWith("/")) return false;
  const parsed = new URL(value, "https://openbot.invalid");
  return (parsed.pathname === "/app" || parsed.pathname === "/billing/return") && !parsed.username && !parsed.password;
}

function stripeEventTimestamp(event: StripeEvent, fallback: number): number | null {
  if (Number.isSafeInteger(event.created) && event.created > 0 && event.created <= Number.MAX_SAFE_INTEGER / 1_000)
    return event.created * 1_000;
  return Number.isSafeInteger(fallback) && fallback > 0 ? fallback : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordValue(value: unknown): StripeEvent["data"]["object"] | null {
  return isStripeObject(value) ? value : null;
}

function isStripeObject(value: unknown): value is StripeEvent["data"]["object"] {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
}

function validProfileId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function billingCurrency(value: string | null): BillingCurrency | null {
  const currency = value?.toLowerCase();
  return currency && isOneOf(BILLING_CURRENCIES, currency) ? currency : null;
}

function invoiceSubscriptionId(object: StripeEvent["data"]["object"]): string | null {
  const direct = stringValue(object.subscription);
  if (direct) return direct;
  const parent = recordValue(object.parent);
  const details = recordValue(parent?.subscription_details);
  return stringValue(details?.subscription);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function failureCode(object: StripeEvent["data"]["object"]): string | undefined {
  const direct = recordValue(object.last_payment_error);
  const code = stringValue(direct?.code) ?? stringValue(direct?.decline_code);
  if (!code) return undefined;
  const normalized = code.toLowerCase().slice(0, 128);
  return SAFE_VALUE_PATTERN.test(normalized) ? normalized : undefined;
}

function parseAttributes(value: string): FactAttributes | null {
  try {
    const record = recordValue(JSON.parse(value));
    if (!record) return null;
    const output: FactAttributes = {};
    if (isOneOf(BILLING_PLAN_IDS, record.plan)) output.plan = record.plan;
    if (isOneOf(BILLING_INTERVALS, record.interval)) output.interval = record.interval;
    if (isOneOf(BILLING_CURRENCIES, record.currency)) output.currency = record.currency;
    if (record.amount === undefined || isBillingAmount(record.amount)) {
      if (record.amount !== undefined) output.amount = record.amount;
    } else return null;
    if (
      record.paymentKind === "first_purchase" ||
      record.paymentKind === "renewal" ||
      record.paymentKind === "adjustment"
    )
      output.paymentKind = record.paymentKind;
    if (typeof record.failureReason === "string" && SAFE_VALUE_PATTERN.test(record.failureReason))
      output.failureReason = record.failureReason;
    if (record.suppressBillingAction === true) output.suppressBillingAction = true;
    return output;
  } catch {
    return null;
  }
}

function hashToken(token: string): Effect.Effect<string, BillingSalesError> {
  return Effect.tryPromise({
    try: async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    catch: () => new BillingSalesError({ code: "database" }),
  });
}
