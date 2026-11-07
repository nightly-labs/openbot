import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
} from "@openbot/contracts/billing";
import { HOSTED_SERVER_ENTRY_POINTS, type HostedServerEntryPoint } from "@openbot/contracts/hosted-servers";
import { LICENSE_METADATA, LICENSE_METADATA_KIND, LICENSE_PRODUCT_ID } from "@openbot/contracts/license";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import {
  type BillingProduct,
  firstTouchProperties,
  isAnalyticsLicenseUsers,
  NO_ACCOUNT_ANALYTICS,
} from "./account-analytics";
import { AccountAttribution } from "./account-attribution";
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
const STRIPE_ID_PATTERN = /^[A-Za-z0-9_]{1,250}$/u;

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
  /** Where the journey started in the app. A value that is not on the list is left out. */
  entryPoint?: HostedServerEntryPoint;
}

/** A license Checkout. It has no server and no return token, so only its fact is stored. */
export interface BillingSalesLicenseCheckout {
  sessionId: string;
  userId: string;
  users: number;
  interval: BillingInterval;
  currency: BillingCurrency;
  /** The amount of one period of the license. */
  amount: number;
  createdAt: number;
  /** True for the license of a server order: the page is the server's, and it has its own fact. */
  order?: boolean;
}

interface BillingSalesSyncedSubscription {
  product?: "server";
  userId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
}

/** A license that the webhook stored. */
interface BillingSalesSyncedLicense {
  product: "license";
  userId: string;
  users: number;
  interval: BillingInterval;
  currency: BillingCurrency;
}

export type BillingSalesSynced = BillingSalesSyncedSubscription | BillingSalesSyncedLicense;

/** The invoice and the subscription that a refunded or disputed payment paid. */
export interface BillingSalesPayment {
  invoiceId: string;
  subscriptionId: string;
}

/**
 * Money that goes back after a paid invoice. A dispute that is opened moves no money by itself:
 * only a lost dispute does. A refund that fails after it succeeded gives the money back.
 */
type PaymentReversalType = "payment_refunded" | "refund_failed" | "payment_disputed" | "dispute_lost";

export interface PaymentReversal {
  type: PaymentReversalType;
  /** The Stripe refund or dispute. */
  objectId: string;
  paymentIntentId: string;
  amount: number;
  currency: BillingCurrency | null;
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
  | "payment_succeeded"
  | PaymentReversalType;

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
  /** Absent in facts from before generation 11, which are all server plans. */
  product?: BillingProduct;
  plan?: BillingPlanId;
  /** For a license: the number of users. */
  users?: number;
  /** On `checkout_started` of a server plan. */
  entryPoint?: HostedServerEntryPoint;
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
      product: "server",
      plan: input.plan,
      interval: input.interval,
      currency: input.currency,
      amount: input.amount,
      ...(isOneOf(HOSTED_SERVER_ENTRY_POINTS, input.entryPoint) ? { entryPoint: input.entryPoint } : {}),
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

  /**
   * Records a started license Checkout. The fact has the same source key as a server Checkout, so a
   * repeated call for one page records it once.
   */
  readonly licenseCheckout = Effect.fn("BillingSales.licenseCheckout")(function* (
    this: BillingSales,
    input: BillingSalesLicenseCheckout,
  ): Effect.fn.Return<void, BillingSalesError> {
    if (
      !SESSION_ID_PATTERN.test(input.sessionId) ||
      !validProfileId(input.userId) ||
      !isAnalyticsLicenseUsers(input.users) ||
      !isOneOf(BILLING_INTERVALS, input.interval) ||
      !isOneOf(BILLING_CURRENCIES, input.currency) ||
      !isBillingAmount(input.amount) ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt <= 0
    )
      return yield* new BillingSalesError({ code: "invalid_input" });
    const attributes = JSON.stringify({
      product: "license",
      users: input.users,
      interval: input.interval,
      currency: input.currency,
      amount: input.amount,
    } satisfies FactAttributes);
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO billing_sales_facts(
               source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
               event_timestamp, attributes_json, delivery_enqueued_at, created_at
             ) VALUES (?, 'checkout_started', ?, NULL, ?, (SELECT id FROM users WHERE id = ?), NULL, ?, ?, NULL, ?)`,
        )
        .bind(
          `checkout:${input.sessionId}:${input.order ? "license:" : ""}started`,
          input.sessionId,
          input.sessionId,
          input.userId,
          input.createdAt,
          attributes,
          input.createdAt,
        )
        .run(),
    );
  }).bind(this);

  readonly webhook = Effect.fn("BillingSales.webhook")(function* (
    this: BillingSales,
    event: StripeEvent,
    synced: BillingSalesSynced | null,
    payment: BillingSalesPayment | null = null,
    options: BillingSalesWebhookOptions = {},
  ): Effect.fn.Return<void, BillingSalesError> {
    const eventTimestamp = stripeEventTimestamp(event, this.#now());
    if (!eventTimestamp) return yield* new BillingSalesError({ code: "invalid_input" });
    const reversal = paymentReversal(event);
    if (reversal) {
      if (payment) yield* this.#reversal(reversal, payment, synced, event.id, eventTimestamp);
      return;
    }
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
      product: "server",
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
    const attributes = row ? checkoutAttributes(row) : yield* this.#startedAttributes(sessionId);
    // A license page that was never reported as started is not reported as ended.
    if (!row && isLicenseSession(metadata) && !attributes) return;
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
          JSON.stringify(attributes ?? {}),
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
    const attributes = row ? checkoutAttributes(row) : yield* this.#startedAttributes(sessionId);
    // A license page that was never reported as started is not reported as expired.
    if (!row && isLicenseSession(metadata) && !attributes) return;
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
          JSON.stringify(attributes ?? {}),
          this.#now(),
        )
        .run(),
    );
  }).bind(this);

  readonly #invoice = Effect.fn("BillingSales.invoice")(function* (
    this: BillingSales,
    event: StripeEvent,
    synced: BillingSalesSynced | null,
    eventTimestamp: number,
    options: BillingSalesWebhookOptions,
  ): Effect.fn.Return<void, BillingSalesError> {
    const object = event.data.object;
    const invoiceId = stringValue(object.id) ?? event.id;
    if (!INVOICE_ID_PATTERN.test(invoiceId)) return yield* new BillingSalesError({ code: "invalid_input" });
    // The split of a server order makes the license subscription with a first invoice of 0. The order's
    // invoice already holds that sale.
    if (isOrderSplitInvoice(object)) return;
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
    const syncedPlan = synced?.product === "license" ? null : synced;
    const license =
      synced?.product === "license"
        ? synced
        : !stored && subscriptionId
          ? yield* this.#storedLicense(subscriptionId)
          : null;
    const product: BillingProduct = license ? "license" : "server";
    const metadata = recordValue(object.metadata);
    const userId = synced?.userId ?? stored?.user_id ?? license?.userId ?? safeId(metadata?.openbot_user_id);
    const serverId = license ? null : (stored?.server_id ?? safeId(metadata?.openbot_server_id));
    const plan = license ? undefined : (syncedPlan?.plan ?? stored?.plan);
    const interval = license ? license.interval : (syncedPlan?.interval ?? stored?.interval);
    const currency =
      billingCurrency(stringValue(object.currency)) ?? synced?.currency ?? stored?.currency ?? license?.currency;
    const amountValue = event.type === "invoice.paid" ? object.amount_paid : object.amount_due;
    const amount = isBillingAmount(amountValue) ? amountValue : null;
    // A server order invoices the server and the license together. Each is its own sale line, with its
    // share of the amount from the invoice lines.
    const lines = license ? null : orderLicenseLines(object);
    const licenseAmount = lines && amount !== null ? Math.round((amount * lines.amount) / lines.total) : null;
    const paymentKind = yield* this.#paymentKind(object.billing_reason, userId, eventTimestamp, product);
    const failureReason = event.type === "invoice.payment_failed" ? failureCode(object) : undefined;
    const shared: FactAttributes = {
      ...(interval ? { interval } : {}),
      ...(currency ? { currency } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(options.suppressBillingAction ? { suppressBillingAction: true } : {}),
    };
    const lineAmount = amount !== null && licenseAmount !== null ? amount - licenseAmount : amount;
    const attributes: FactAttributes = {
      product,
      ...(plan ? { plan } : {}),
      ...(license && isAnalyticsLicenseUsers(license.users) ? { users: license.users } : {}),
      ...shared,
      ...(lineAmount !== null ? { amount: lineAmount } : {}),
      ...(paymentKind ? { paymentKind } : {}),
    };
    const failedAttemptKey =
      event.type === "invoice.payment_failed"
        ? positiveInteger(object.attempt_count)
          ? String(object.attempt_count)
          : event.id
        : null;
    const sourceKey =
      event.type === "invoice.paid" ? `invoice:${invoiceId}:paid` : `invoice:${invoiceId}:failed:${failedAttemptKey}`;
    const facts: { sourceKey: string; serverId: string | null; attributes: FactAttributes }[] = [
      { sourceKey, serverId, attributes },
    ];
    if (lines) {
      const licenseKind = yield* this.#paymentKind(object.billing_reason, userId, eventTimestamp, "license");
      facts.push({
        sourceKey: `${sourceKey}:license`,
        serverId: null,
        attributes: {
          product: "license",
          ...(isAnalyticsLicenseUsers(lines.users) ? { users: lines.users } : {}),
          ...shared,
          ...(licenseAmount !== null ? { amount: licenseAmount } : {}),
          ...(licenseKind ? { paymentKind: licenseKind } : {}),
        },
      });
    }
    yield* d1(this.#database, () =>
      this.#database.batch(
        facts.map((fact) =>
          this.#database
            .prepare(
              `INSERT OR IGNORE INTO billing_sales_facts(
                   source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
                   event_timestamp, attributes_json, delivery_enqueued_at, created_at
                 ) VALUES (?, ?, ?, ?, NULL, (SELECT id FROM users WHERE id = ?), ?, ?, ?, NULL, ?)`,
            )
            .bind(
              fact.sourceKey,
              event.type === "invoice.paid" ? "payment_succeeded" : "payment_failed",
              event.id,
              invoiceId,
              userId,
              fact.serverId,
              eventTimestamp,
              JSON.stringify(fact.attributes),
              this.#now(),
            ),
        ),
      ),
    );
  }).bind(this);

  readonly #reversal = Effect.fn("BillingSales.reversal")(function* (
    this: BillingSales,
    reversal: PaymentReversal,
    payment: BillingSalesPayment,
    synced: BillingSalesSynced | null,
    eventId: string,
    eventTimestamp: number,
  ): Effect.fn.Return<void, BillingSalesError> {
    if (!INVOICE_ID_PATTERN.test(payment.invoiceId)) return yield* new BillingSalesError({ code: "invalid_input" });
    const stored = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT user_id, server_id, plan, interval FROM billing_subscriptions WHERE stripe_subscription_id = ?`,
        )
        .bind(payment.subscriptionId)
        .first<{ user_id: string; server_id: string | null; plan: BillingPlanId; interval: BillingInterval }>(),
    );
    const license = stored
      ? null
      : synced?.product === "license"
        ? synced
        : yield* this.#storedLicense(payment.subscriptionId);
    // A payment of a subscription that is not an OpenBot plan or license is not an OpenBot sale.
    if (!stored && !license) return;
    const syncedPlan = synced?.product === "license" ? null : synced;
    const attributes: FactAttributes = stored
      ? {
          product: "server",
          plan: syncedPlan?.plan ?? stored.plan,
          interval: syncedPlan?.interval ?? stored.interval,
          ...(reversal.currency ? { currency: reversal.currency } : {}),
          amount: reversal.amount,
        }
      : {
          product: "license",
          ...(license && isAnalyticsLicenseUsers(license.users) ? { users: license.users } : {}),
          interval: license?.interval ?? "month",
          ...(reversal.currency ? { currency: reversal.currency } : {}),
          amount: reversal.amount,
        };
    const ownerId = synced?.userId ?? stored?.user_id ?? license?.userId ?? null;
    const prefix = reversal.type === "payment_refunded" || reversal.type === "refund_failed" ? "refund" : "dispute";
    const suffix = {
      payment_refunded: "succeeded",
      refund_failed: "failed",
      payment_disputed: "created",
      dispute_lost: "lost",
    }[reversal.type];
    const sourceKey = `${prefix}:${reversal.objectId}:${suffix}`;
    // Stripe does not keep the event order. A refund that already failed does not count when its
    // success arrives later; the failed fact is sent only when the success was counted.
    const failed = reversal.type === "payment_refunded" ? `refund:${reversal.objectId}:failed` : null;
    yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO billing_sales_facts(
               source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
               event_timestamp, attributes_json, delivery_enqueued_at, created_at
             )
             SELECT ?, ?, ?, ?, NULL, (SELECT id FROM users WHERE id = ?), ?, ?, ?, NULL, ?
              WHERE ? IS NULL OR NOT EXISTS (SELECT 1 FROM billing_sales_facts WHERE source_key = ?)`,
        )
        .bind(
          sourceKey,
          reversal.type,
          eventId,
          payment.invoiceId,
          ownerId,
          stored?.server_id ?? null,
          eventTimestamp,
          JSON.stringify(attributes),
          this.#now(),
          failed,
          failed,
        )
        .run(),
    );
  }).bind(this);

  readonly #paymentKind = Effect.fn("BillingSales.paymentKind")(function* (
    this: BillingSales,
    billingReason: unknown,
    userId: string | null,
    eventTimestamp: number,
    product: BillingProduct,
  ): Effect.fn.Return<FactAttributes["paymentKind"], BillingSalesError> {
    if (billingReason === "subscription_create") return "first_purchase";
    if (billingReason === "subscription_cycle" || billingReason === "subscription_threshold") return "renewal";
    if (billingReason === "subscription_update" || billingReason === "manual") return "adjustment";
    if (!userId) return undefined;
    const previous = yield* d1(this.#database, () =>
      this.#database
        .prepare(
          `SELECT 1 AS seen FROM billing_sales_facts
              WHERE fact_type = 'payment_succeeded' AND user_id = ? AND event_timestamp < ?
                AND ${PRODUCT_SQL} = ? LIMIT 1`,
        )
        .bind(userId, eventTimestamp, product)
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
    // fact remains available for conversion queries; paid is emitted from invoice.paid only. A failed
    // refund that was never counted as succeeded moves no money, so it sends nothing.
    if (
      row.fact_type === "checkout_completed" ||
      (row.fact_type === "refund_failed" && !(yield* this.#refundCounted(row)))
    ) {
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
    const product: BillingProduct = attributes.product ?? "server";
    const productProperties = {
      product,
      ...(product === "server" && attributes.plan ? { plan: attributes.plan } : {}),
      ...(product === "license" && attributes.users !== undefined ? { users: attributes.users } : {}),
    };
    const actionProperties = {
      ...productProperties,
      ...(attributes.interval ? { interval: attributes.interval } : {}),
      ...(attributes.currency ? { currency: attributes.currency } : {}),
      ...(attributes.amount !== undefined ? { amount: attributes.amount } : {}),
    };
    if (row.fact_type === "payment_succeeded") {
      const recovery = yield* this.#recovery(row.invoice_id, profileId, eventTimestamp, product);
      // The source of the account, when it is known at this time. `account_attributed` names it later.
      const firstTouch = profileId
        ? firstTouchProperties(
            yield* new AccountAttribution({ database: this.#database, analytics: NO_ACCOUNT_ANALYTICS })
              .read(profileId)
              .pipe(Effect.mapError(() => new BillingSalesError({ code: "database" }))),
          )
        : {};
      if (!attributes.suppressBillingAction)
        yield* this.#enqueue(
          `billing:${row.source_key}`,
          profileId,
          "billing_action",
          { ...actionProperties, action: "payment_succeeded", ...(recovery ? { recovery } : {}), ...firstTouch },
          eventTimestamp,
        );
      if (attributes.amount !== undefined && attributes.amount > 0 && attributes.currency) {
        const converted = yield* this.#usd(attributes.amount, attributes.currency, eventTimestamp);
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
            ...productProperties,
            ...(attributes.interval ? { interval: attributes.interval } : {}),
            payment_kind: attributes.paymentKind ?? "adjustment",
            ...(recovery ? { recovery } : {}),
            ...firstTouch,
          },
          eventTimestamp,
        );
      }
    } else if (isReversalFact(row.fact_type)) {
      // Revenue counts each paid invoice once and is never negative, so money that goes back is a
      // separate action with its own USD amount. Net revenue subtracts it.
      // A small partial refund can round to 0 USD. It is sent with no USD amount.
      const converted =
        attributes.amount !== undefined && attributes.amount > 0 && attributes.currency
          ? yield* this.#convert(attributes.amount, attributes.currency, eventTimestamp)
          : null;
      yield* this.#enqueue(
        `billing:${row.source_key}`,
        profileId,
        "billing_action",
        {
          ...actionProperties,
          action: row.fact_type,
          ...(converted && converted.amountUsd > 0
            ? { amount_usd: converted.amountUsd, fx_rate: converted.fxRate, fx_date: converted.fxDate }
            : {}),
        },
        eventTimestamp,
      );
    } else {
      const eventName = "billing_action" as const;
      const eventProperties =
        row.fact_type === "checkout_started"
          ? {
              ...actionProperties,
              action: "checkout_started",
              checkout_status: "started",
              ...(attributes.entryPoint ? { entry_point: attributes.entryPoint } : {}),
            }
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

  readonly #usd = Effect.fn("BillingSales.usd")(function* (
    this: BillingSales,
    amount: number,
    currency: BillingCurrency,
    eventTimestamp: number,
  ): Effect.fn.Return<{ amountUsd: number; fxRate: number; fxDate: string }, BillingSalesError> {
    const converted = yield* this.#convert(amount, currency, eventTimestamp);
    if (converted.amountUsd <= 0) return yield* new BillingSalesError({ code: "currency" });
    return converted;
  }).bind(this);

  readonly #convert = Effect.fn("BillingSales.convert")(function* (
    this: BillingSales,
    amount: number,
    currency: BillingCurrency,
    eventTimestamp: number,
  ): Effect.fn.Return<{ amountUsd: number; fxRate: number; fxDate: string }, BillingSalesError> {
    const converted = yield* new BillingUsd({ database: this.#database, fetch: this.#fetch })
      .convert(amount, currency, eventTimestamp)
      .pipe(
        Effect.mapError((error) =>
          error instanceof BillingUsdError
            ? new BillingSalesError({ code: "currency" })
            : new BillingSalesError({ code: "currency" }),
        ),
      );
    if (!Number.isSafeInteger(converted.amountUsd) || converted.amountUsd < 0)
      return yield* new BillingSalesError({ code: "currency" });
    return converted;
  }).bind(this);

  /** True when the refund of a `refund_failed` fact was counted as succeeded. */
  readonly #refundCounted = Effect.fn("BillingSales.refundCounted")(function* (
    this: BillingSales,
    row: FactRow,
  ): Effect.fn.Return<boolean, BillingSalesError> {
    const counted = yield* d1(this.#database, () =>
      this.#database
        .prepare("SELECT 1 AS seen FROM billing_sales_facts WHERE source_key = ?")
        .bind(row.source_key.replace(/:failed$/u, ":succeeded"))
        .first<{ seen: number }>(),
    );
    return Boolean(counted);
  }).bind(this);

  readonly #recovery = Effect.fn("BillingSales.recovery")(function* (
    this: BillingSales,
    invoiceId: string | null,
    profileId: string | null,
    eventTimestamp: number,
    product: BillingProduct,
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
                    AND event_timestamp <= ? AND event_timestamp > ? AND ${PRODUCT_SQL} = ? LIMIT 1`,
            )
            .bind(profileId, eventTimestamp, eventTimestamp - RECOVERY_WINDOW_MS, product)
            .first<{ seen: number }>(),
        )
      : null;
    if (invoice && checkout) return "invoice";
    if (invoice) return "invoice";
    if (checkout) return "checkout";
    return null;
  }).bind(this);

  /** The attributes of the started fact of a Checkout that has no checkout row, or null without one. */
  readonly #startedAttributes = Effect.fn("BillingSales.startedAttributes")(function* (
    this: BillingSales,
    sessionId: string,
  ): Effect.fn.Return<FactAttributes | null, BillingSalesError> {
    const started = yield* d1(this.#database, () =>
      this.#database
        .prepare("SELECT attributes_json FROM billing_sales_facts WHERE source_key = ?")
        .bind(`checkout:${sessionId}:started`)
        .first<{ attributes_json: string }>(),
    );
    return started ? parseAttributes(started.attributes_json) : null;
  }).bind(this);

  /** The stored license of a subscription, or null when it is not a license. */
  readonly #storedLicense = Effect.fn("BillingSales.storedLicense")(function* (
    this: BillingSales,
    subscriptionId: string,
  ): Effect.fn.Return<
    { userId: string; users: number; interval: BillingInterval; currency: BillingCurrency | null } | null,
    BillingSalesError
  > {
    const row = yield* d1(this.#database, () =>
      this.#database
        .prepare("SELECT user_id, users, billing_interval, currency FROM licenses WHERE stripe_subscription_id = ?")
        .bind(subscriptionId)
        .first<{ user_id: string; users: number; billing_interval: string | null; currency: string }>(),
    );
    if (!row) return null;
    return {
      userId: row.user_id,
      users: row.users,
      // A license from before the tiers has no interval and is monthly.
      interval: isOneOf(BILLING_INTERVALS, row.billing_interval) ? row.billing_interval : "month",
      currency: billingCurrency(row.currency),
    };
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

/**
 * The refund or dispute that an event reports, or null for an event that moves no money back. A refund
 * counts when it succeeded; a pending refund counts with the `refund.updated` that ends it.
 */
export function paymentReversal(event: StripeEvent): PaymentReversal | null {
  const object = event.data.object;
  const status = stringValue(object.status);
  const type: PaymentReversalType | null =
    (event.type === "refund.created" || event.type === "refund.updated") && status === "succeeded"
      ? "payment_refunded"
      : event.type === "refund.failed"
        ? "refund_failed"
        : event.type === "charge.dispute.created"
          ? "payment_disputed"
          : event.type === "charge.dispute.closed" && status === "lost"
            ? "dispute_lost"
            : null;
  if (!type) return null;
  const objectId = stringValue(object.id);
  const intent = recordValue(object.payment_intent);
  const paymentIntentId = stringValue(object.payment_intent) ?? stringValue(intent?.id);
  if (!objectId || !STRIPE_ID_PATTERN.test(objectId) || !paymentIntentId || !STRIPE_ID_PATTERN.test(paymentIntentId))
    return null;
  if (!isBillingAmount(object.amount)) return null;
  return {
    type,
    objectId,
    paymentIntentId,
    amount: object.amount,
    currency: billingCurrency(stringValue(object.currency)),
  };
}

function isReversalFact(type: FactType): type is PaymentReversalType {
  return (
    type === "payment_refunded" || type === "refund_failed" || type === "payment_disputed" || type === "dispute_lost"
  );
}

/** The product of a stored fact. Facts from before generation 11 have none and are all server plans. */
const PRODUCT_SQL = "COALESCE(json_extract(attributes_json, '$.product'), 'server')";

function checkoutAttributes(row: CheckoutRow): FactAttributes {
  return { product: "server", plan: row.plan, interval: row.interval, currency: row.currency, amount: row.amount };
}

/** True for the metadata of a license Checkout page. */
function isLicenseSession(metadata: StripeEvent["data"]["object"] | null): boolean {
  return metadata?.[LICENSE_METADATA.kind] === LICENSE_METADATA_KIND;
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
  // `//host/app` and `/\host/app` start with a slash but resolve to another origin.
  const parsed = new URL(value, "https://openbot.invalid");
  return (
    parsed.origin === "https://openbot.invalid" &&
    (parsed.pathname === "/app" || parsed.pathname === "/billing/return") &&
    !parsed.username &&
    !parsed.password
  );
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

/**
 * The license lines of a server order's invoice: their amount, the amount of all lines, and the users.
 * Null for an invoice with no license line or with only license lines. The license Product names a line.
 */
function orderLicenseLines(
  object: StripeEvent["data"]["object"],
): { amount: number; total: number; users: number } | null {
  const lines = recordValue(object.lines)?.data;
  if (!Array.isArray(lines)) return null;
  let amount = 0;
  let total = 0;
  let users = 0;
  let server = false;
  for (const value of lines) {
    const line = recordValue(value);
    if (!line || !isBillingAmount(line.amount)) continue;
    total += line.amount;
    const product = stringValue(recordValue(recordValue(line.pricing)?.price_details)?.product);
    if (product !== LICENSE_PRODUCT_ID) {
      server = true;
      continue;
    }
    amount += line.amount;
    if (positiveInteger(line.quantity)) users += line.quantity;
  }
  return server && amount > 0 && total > 0 ? { amount, total, users } : null;
}

/** True for the first invoice of a license that the split of a server order made. */
function isOrderSplitInvoice(object: StripeEvent["data"]["object"]): boolean {
  const details = recordValue(recordValue(object.parent)?.subscription_details);
  return (
    object.billing_reason === "subscription_create" &&
    stringValue(recordValue(details?.metadata)?.[LICENSE_METADATA.orderSubscription]) !== null
  );
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
    if (record.product === "server" || record.product === "license") output.product = record.product;
    if (isOneOf(BILLING_PLAN_IDS, record.plan)) output.plan = record.plan;
    if (isAnalyticsLicenseUsers(record.users)) output.users = record.users;
    if (isOneOf(HOSTED_SERVER_ENTRY_POINTS, record.entryPoint)) output.entryPoint = record.entryPoint;
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
