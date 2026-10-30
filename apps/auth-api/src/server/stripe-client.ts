import { BILLING_CURRENCIES, BILLING_METADATA, type BillingCurrency } from "@openbot/contracts/billing";
import { LICENSE_LOOKUP_KEYS, LICENSE_METADATA, LICENSE_METADATA_KIND } from "@openbot/contracts/license";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Option, Result, Schema } from "effect";
import { constantTimeEqual, hexToBytes, importHmacSha256Key } from "./crypto";

/** Stripe changes response shapes by API version, so every request names the version this code reads. */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const STRIPE_API_ORIGIN = "https://api.stripe.com";
const STRIPE_TIMEOUT_MS = 10_000;
/** Stripe's recommended tolerance for the webhook timestamp. */
const SIGNATURE_TOLERANCE_SECONDS = 300;
/**
 * A Checkout page stays open this long. Stripe accepts 30 minutes to 24 hours from its own clock, so this
 * keeps a margin for clock skew and request time.
 */
const CHECKOUT_LIFETIME_SECONDS = 35 * 60;

export type StripeFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * A Stripe request failed. The message holds only Stripe's error `type` and `code`, never the key, the
 * request body or Stripe's own message, which can repeat customer data.
 */
export class StripeRequestError extends Schema.TaggedError<StripeRequestError>()("StripeRequestError", {
  status: Schema.Number,
  type: Schema.NullOr(Schema.String),
  code: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {
  constructor(status: number, type: string | null, code: string | null) {
    super({
      status,
      type,
      code,
      message: `Stripe request failed with ${status} (${type ?? "unknown"}${code ? `/${code}` : ""}).`,
    });
  }
}
export class StripeTransportError extends Schema.TaggedError<StripeTransportError>()("StripeTransportError", {}) {}

const Metadata = Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed({})));
const CurrencyOptions = Schema.optional(
  Schema.Record(Schema.String, Schema.Struct({ unit_amount: Schema.optional(Schema.NullOr(Schema.Int)) })),
);
const stripeErrorSchema = Schema.Struct({
  error: Schema.Struct({ type: Schema.optional(Schema.String), code: Schema.optional(Schema.String) }),
});
const sessionSchema = Schema.Struct({ id: Schema.String, url: Schema.NullOr(Schema.String) });
const customerSchema = Schema.Struct({ id: Schema.String, deleted: Schema.optional(Schema.Boolean) });
const deletedSchema = Schema.Struct({ id: Schema.String });
const checkoutSessionSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  subscription: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Metadata,
});
export type StripeCheckoutSession = typeof checkoutSessionSchema.Type;
const checkoutSessionListSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ ...checkoutSessionSchema.fields, created: Schema.Int })),
});
export type StripeOpenCheckoutSession = (typeof checkoutSessionListSchema.Type)["data"][number];
const priceSchema = Schema.Struct({
  id: Schema.String,
  lookup_key: Schema.NullOr(Schema.String),
  currency: Schema.String,
  unit_amount: Schema.NullOr(Schema.Int),
  currency_options: CurrencyOptions,
  metadata: Metadata,
});
export type StripePrice = typeof priceSchema.Type;
const priceListSchema = Schema.Struct({ data: Schema.Array(priceSchema) });
const expandable = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]);
const subscriptionSchema = Schema.Struct({
  id: Schema.String,
  customer: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]),
  status: Schema.String,
  currency: Schema.String,
  cancel_at_period_end: Schema.Boolean,
  cancel_at: Schema.optional(Schema.NullOr(Schema.Int)),
  metadata: Metadata,
  current_period_end: Schema.optional(Schema.Int),
  latest_invoice: Schema.optional(Schema.NullOr(expandable)),
  default_payment_method: Schema.optional(Schema.NullOr(expandable)),
  items: Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        current_period_end: Schema.optional(Schema.Int),
        quantity: Schema.optional(Schema.Int),
        price: Schema.Struct({
          id: Schema.String,
          lookup_key: Schema.NullOr(Schema.String),
          metadata: Metadata,
          currency: Schema.String,
          unit_amount: Schema.NullOr(Schema.Int),
          currency_options: CurrencyOptions,
        }),
      }),
    ),
  }),
});
export type StripeSubscription = typeof subscriptionSchema.Type;
export type StripeSubscriptionItem = StripeSubscription["items"]["data"][number];
const subscriptionListSchema = Schema.Struct({ data: Schema.Array(subscriptionSchema) });
const invoicePaymentListSchema = Schema.Struct({ data: Schema.Array(Schema.Struct({ invoice: expandable })) });
const invoiceSchema = Schema.Struct({
  id: Schema.String,
  billing_reason: Schema.optional(Schema.NullOr(Schema.String)),
  parent: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        subscription_details: Schema.optional(
          Schema.NullOr(Schema.Struct({ subscription: Schema.optional(Schema.NullOr(expandable)) })),
        ),
      }),
    ),
  ),
});
const paymentIntentSchema = Schema.Struct({
  latest_charge: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Struct({ refunded: Schema.Boolean })])),
  ),
});
const eventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  created: Schema.Int,
  data: Schema.Struct({ object: Schema.Record(Schema.String, Schema.Unknown) }),
});
export type StripeEvent = typeof eventSchema.Type;

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return isOneOf(BILLING_CURRENCIES, value);
}

export class StripeClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetcher: StripeFetch,
  ) {}

  /**
   * A Customer Portal page. With a flow it opens on the plan change or the cancel page of one
   * subscription, and goes back to `returnUrl` when that step is done.
   */

  readonly createPortalSession = Effect.fn("StripeClient.createPortalSession")(function* (
    this: StripeClient,
    input: {
      customerId: string;
      returnUrl: string;
      flow?: { type: "subscription_update" | "subscription_cancel"; subscriptionId: string };
    },
  ): Effect.fn.Return<string, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl });
    if (input.flow) {
      body.set("flow_data[type]", input.flow.type);
      body.set(`flow_data[${input.flow.type}][subscription]`, input.flow.subscriptionId);
      body.set("flow_data[after_completion][type]", "redirect");
      body.set("flow_data[after_completion][redirect][return_url]", input.returnUrl);
    }
    const session = yield* this.#requestEffect("POST", "/v1/billing_portal/sessions", body, sessionSchema);
    if (!session.url) return yield* new StripeRequestError(200, "invalid_response", "missing_url");
    return session.url;
  }).bind(this);

  /** The subscription, with the Price amount in each currency, so the plan's own currency has a price. */

  readonly getSubscription = Effect.fn("StripeClient.getSubscription")(function* (
    this: StripeClient,
    subscriptionId: string,
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ "expand[]": "items.data.price.currency_options" });
    return yield* this.#requestEffect(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}?${query}`,
      null,
      subscriptionSchema,
    );
  }).bind(this);

  readonly setRenewal = Effect.fn("StripeClient.setRenewal")(function* (
    this: StripeClient,
    subscriptionId: string,
    cancelAtPeriodEnd: boolean,
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    // Stripe refuses both parameters in one request. An empty `cancel_at` clears a period-end cancel
    // and a dated cancel from the Customer Portal.
    const body = new URLSearchParams(cancelAtPeriodEnd ? { cancel_at_period_end: "true" } : { cancel_at: "" });
    return yield* this.#requestEffect(
      "POST",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      body,
      subscriptionSchema,
    );
  }).bind(this);

  /**
   * Sets the quantity of one subscription item. With `always_invoice`, Stripe invoices the prorated
   * difference now and refuses the change when that payment fails, so the quantity never goes up unpaid.
   * With `none`, the new quantity applies from the next invoice. A `priceId` also moves the item to
   * that Price, with the same proration.
   */

  readonly setSubscriptionQuantity = Effect.fn("StripeClient.setSubscriptionQuantity")(function* (
    this: StripeClient,
    input: {
      subscriptionId: string;
      itemId: string;
      quantity: number;
      proration: "always_invoice" | "none";
      priceId?: string;
      metadata?: Readonly<Record<string, string>>;
    },
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({
      "items[0][id]": input.itemId,
      "items[0][quantity]": String(input.quantity),
      proration_behavior: input.proration,
    });
    if (input.priceId) body.set("items[0][price]", input.priceId);
    for (const [key, value] of Object.entries(input.metadata ?? {})) body.set(`metadata[${key}]`, value);
    if (input.proration === "always_invoice") body.set("payment_behavior", "error_if_incomplete");
    return yield* this.#requestEffect(
      "POST",
      `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      body,
      subscriptionSchema,
    );
  }).bind(this);

  /** The active Prices with these lookup keys, with the amount in each currency. */

  readonly listPricesByLookupKeys = Effect.fn("StripeClient.listPricesByLookupKeys")(function* (
    this: StripeClient,
    lookupKeys: readonly string[],
  ): Effect.fn.Return<StripePrice[], StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ active: "true", limit: "100" });
    for (const key of lookupKeys) query.append("lookup_keys[]", key);
    query.append("expand[]", "data.currency_options");
    return [...(yield* this.#requestEffect("GET", `/v1/prices?${query}`, null, priceListSchema)).data];
  }).bind(this);

  /** The same idempotency key gives the same customer, so two requests at once make one customer. */

  readonly createCustomer = Effect.fn("StripeClient.createCustomer")(function* (
    this: StripeClient,
    input: { userId: string; email: string },
    idempotencyKey: string,
  ): Effect.fn.Return<string, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({ email: input.email, [`metadata[${BILLING_METADATA.userId}]`]: input.userId });
    return (yield* this.#requestEffect("POST", "/v1/customers", body, customerSchema, idempotencyKey)).id;
  }).bind(this);

  /**
   * True when the customer was deleted in Stripe. Stripe still returns a deleted customer, with
   * `deleted`. A customer of another Stripe account, or of test data that was reset, does not exist.
   */

  readonly isCustomerDeleted = Effect.fn("StripeClient.isCustomerDeleted")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<boolean, StripeRequestError | StripeTransportError> {
    const path = `/v1/customers/${encodeURIComponent(customerId)}`;
    const result = yield* Effect.result(this.#requestEffect("GET", path, null, customerSchema));
    if (Result.isFailure(result)) {
      if (result.failure instanceof StripeRequestError && result.failure.status === 404) return true;
      return yield* result.failure;
    }
    return result.success.deleted === true;
  }).bind(this);

  /**
   * A subscription Checkout for one server, or for the license when `serverId` is absent. The metadata goes
   * on the session and on the subscription, so the webhook links the subscription to the account and the
   * server. Each call makes a new page, so it takes no idempotency key: the caller closes the other pages.
   */

  readonly createCheckoutSession = Effect.fn("StripeClient.createCheckoutSession")(function* (
    this: StripeClient,
    input: {
      customerId: string;
      priceId: string;
      currency: BillingCurrency;
      userId: string;
      serverId?: string;
      /** The number of units. A server plan is 1. A license is its number of users. */
      quantity?: number;
      /**
       * More Prices on the same subscription and invoice, such as the license of a server order. Each must
       * have the interval and the currency of `priceId`.
       */
      extraItems?: readonly { priceId: string; quantity: number }[];
      /** More metadata for the session and the subscription. */
      metadata?: Readonly<Record<string, string>>;
      /** Metadata for the session only, such as the order that a later page for the same server repeats. */
      sessionMetadata?: Readonly<Record<string, string>>;
      /** The subscription is free until this time. Stripe refuses a time less than 48 hours away. */
      trialEndSeconds?: number;
      successUrl: string;
      cancelUrl: string;
      nowSeconds: number;
    },
  ): Effect.fn.Return<{ id: string; url: string }, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({
      mode: "subscription",
      customer: input.customerId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": String(input.quantity ?? 1),
      currency: input.currency,
      // Card collection stays on, so a plan that a code discounts only at the start can still renew.
      allow_promotion_codes: "true",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: String(input.nowSeconds + CHECKOUT_LIFETIME_SECONDS),
    });
    for (const [index, item] of (input.extraItems ?? []).entries()) {
      body.set(`line_items[${index + 1}][price]`, item.priceId);
      body.set(`line_items[${index + 1}][quantity]`, String(item.quantity));
    }
    if (input.serverId) body.set("client_reference_id", input.serverId);
    if (input.trialEndSeconds !== undefined) body.set("subscription_data[trial_end]", String(input.trialEndSeconds));
    for (const prefix of ["metadata", "subscription_data[metadata]"]) {
      body.set(`${prefix}[${BILLING_METADATA.userId}]`, input.userId);
      if (input.serverId) body.set(`${prefix}[${BILLING_METADATA.serverId}]`, input.serverId);
      for (const [key, value] of Object.entries(input.metadata ?? {})) body.set(`${prefix}[${key}]`, value);
    }
    for (const [key, value] of Object.entries(input.sessionMetadata ?? {})) body.set(`metadata[${key}]`, value);
    const session = yield* this.#requestEffect("POST", "/v1/checkout/sessions", body, checkoutSessionSchema);
    if (!session.url) return yield* new StripeRequestError(200, "invalid_response", "missing_url");
    return { id: session.id, url: session.url };
  }).bind(this);

  /**
   * Closes a Checkout page. Returns the page in its final status: `expired`, or `complete` for a page
   * that the user paid. Stripe refuses to expire a session that is not open, so the service then reads it.
   */

  readonly expireCheckoutSession = Effect.fn("StripeClient.expireCheckoutSession")(function* (
    this: StripeClient,
    sessionId: string,
  ): Effect.fn.Return<StripeCheckoutSession, StripeRequestError | StripeTransportError> {
    const path = `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`;
    const result = yield* Effect.result(
      this.#requestEffect("POST", `${path}/expire`, new URLSearchParams(), checkoutSessionSchema),
    );
    if (Result.isSuccess(result)) return result.success;
    if (!(result.failure instanceof StripeRequestError) || result.failure.status !== 400) return yield* result.failure;
    return yield* this.#requestEffect("GET", path, null, checkoutSessionSchema);
  }).bind(this);

  /** The open Checkout pages of a customer, with their metadata. */

  readonly listOpenCheckoutSessions = Effect.fn("StripeClient.listOpenCheckoutSessions")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<StripeOpenCheckoutSession[], StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ customer: customerId, status: "open", limit: "100" });
    return [
      ...(yield* this.#requestEffect("GET", `/v1/checkout/sessions?${query}`, null, checkoutSessionListSchema)).data,
    ];
  }).bind(this);

  /** All subscriptions of a customer, also the ended ones. */

  readonly listCustomerSubscriptions = Effect.fn("StripeClient.listCustomerSubscriptions")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<StripeSubscription[], StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ customer: customerId, status: "all", limit: "100" });
    return [...(yield* this.#requestEffect("GET", `/v1/subscriptions?${query}`, null, subscriptionListSchema)).data];
  }).bind(this);

  /**
   * Makes a subscription with one Price that renews at `anchorSeconds`. Stripe charges nothing until then:
   * the period up to the anchor has no proration. With `trial`, that period is a free trial, and the
   * subscription is `trialing` until it ends. The same idempotency key gives the same subscription.
   */

  readonly createSubscription = Effect.fn("StripeClient.createSubscription")(function* (
    this: StripeClient,
    input: {
      customerId: string;
      priceId: string;
      quantity: number;
      currency: BillingCurrency;
      anchorSeconds: number;
      trial?: boolean;
      paymentMethodId: string | null;
      metadata: Readonly<Record<string, string>>;
    },
    idempotencyKey: string,
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({
      customer: input.customerId,
      "items[0][price]": input.priceId,
      "items[0][quantity]": String(input.quantity),
      currency: input.currency,
      ...(input.trial
        ? { trial_end: String(input.anchorSeconds) }
        : { billing_cycle_anchor: String(input.anchorSeconds), proration_behavior: "none" }),
      "expand[]": "items.data.price.currency_options",
    });
    if (input.paymentMethodId) body.set("default_payment_method", input.paymentMethodId);
    for (const [key, value] of Object.entries(input.metadata)) body.set(`metadata[${key}]`, value);
    return yield* this.#requestEffect("POST", "/v1/subscriptions", body, subscriptionSchema, idempotencyKey);
  }).bind(this);

  /** Sets metadata on a subscription. An empty value removes the key. */

  readonly setSubscriptionMetadata = Effect.fn("StripeClient.setSubscriptionMetadata")(function* (
    this: StripeClient,
    subscriptionId: string,
    metadata: Readonly<Record<string, string>>,
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(metadata)) body.set(`metadata[${key}]`, value);
    yield* this.#requestEffect(
      "POST",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      body,
      subscriptionSchema,
    );
  }).bind(this);

  /** Removes one item from a subscription. With no proration, Stripe gives no credit for the rest of the period. */

  readonly deleteSubscriptionItem = Effect.fn("StripeClient.deleteSubscriptionItem")(function* (
    this: StripeClient,
    itemId: string,
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ proration_behavior: "none" });
    const result = yield* Effect.result(
      this.#requestEffect(
        "DELETE",
        `/v1/subscription_items/${encodeURIComponent(itemId)}?${query}`,
        null,
        deletedSchema,
      ),
    );
    // An item that an earlier attempt removed is already gone.
    if (Result.isFailure(result) && !(result.failure instanceof StripeRequestError && result.failure.status === 404))
      return yield* result.failure;
  }).bind(this);

  /** Cancels a subscription now. Stripe gives no refund and no credit for the rest of the period. */

  readonly cancelSubscription = Effect.fn("StripeClient.cancelSubscription")(function* (
    this: StripeClient,
    subscriptionId: string,
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    return yield* this.#requestEffect(
      "DELETE",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      null,
      subscriptionSchema,
    );
  }).bind(this);

  /**
   * The invoice that a PaymentIntent paid, the subscription of that invoice and why Stripe made it. Null for
   * a payment of no subscription invoice. From API version 2025-03-31 a charge does not name its invoice.
   */

  readonly getPaymentInvoice = Effect.fn("StripeClient.getPaymentInvoice")(function* (
    this: StripeClient,
    paymentIntentId: string,
  ): Effect.fn.Return<
    { invoiceId: string; subscriptionId: string; billingReason: string | null } | null,
    StripeRequestError | StripeTransportError
  > {
    const query = new URLSearchParams({
      "payment[type]": "payment_intent",
      "payment[payment_intent]": paymentIntentId,
      limit: "1",
    });
    const payments = yield* this.#requestEffect("GET", `/v1/invoice_payments?${query}`, null, invoicePaymentListSchema);
    const invoice = payments.data[0]?.invoice;
    if (!invoice) return null;
    const invoiceId = typeof invoice === "string" ? invoice : invoice.id;
    const path = `/v1/invoices/${encodeURIComponent(invoiceId)}`;
    const invoiceRecord = yield* this.#requestEffect("GET", path, null, invoiceSchema);
    const subscription = invoiceRecord.parent?.subscription_details?.subscription;
    if (!subscription) return null;
    return {
      invoiceId,
      subscriptionId: typeof subscription === "string" ? subscription : subscription.id,
      billingReason: invoiceRecord.billing_reason ?? null,
    };
  }).bind(this);

  /** True when the refunds of the PaymentIntent's charge add up to its full amount. */

  readonly isPaymentRefunded = Effect.fn("StripeClient.isPaymentRefunded")(function* (
    this: StripeClient,
    paymentIntentId: string,
  ): Effect.fn.Return<boolean, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ "expand[]": "latest_charge" });
    const path = `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?${query}`;
    const charge = (yield* this.#requestEffect("GET", path, null, paymentIntentSchema)).latest_charge;
    return typeof charge === "object" && charge !== null && charge.refunded;
  }).bind(this);

  readonly #requestEffect = Effect.fn("StripeClient.request")(function* <T>(
    this: StripeClient,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: URLSearchParams | null,
    schema: Schema.Decoder<T>,
    idempotencyKey?: string,
  ): Effect.fn.Return<T, StripeRequestError | StripeTransportError> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.fetcher(`${STRIPE_API_ORIGIN}${path}`, {
          method,
          headers,
          ...(body ? { body: body.toString() } : {}),
          signal: AbortSignal.any([signal, AbortSignal.timeout(STRIPE_TIMEOUT_MS)]),
        }),
      catch: () => new StripeTransportError({}),
    });
    const value = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new StripeTransportError({}),
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response.ok) {
      const parsed = Schema.decodeUnknownOption(stripeErrorSchema)(value);
      return yield* new StripeRequestError(
        response.status,
        Option.isSome(parsed) ? (parsed.value.error.type ?? null) : null,
        Option.isSome(parsed) ? (parsed.value.error.code ?? null) : null,
      );
    }
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(() => new StripeRequestError(response.status, "invalid_response", null)),
    );
  });
}

/** True for a Price of the license: a license lookup key, or the license kind in its metadata. */
export function isLicensePrice(price: { lookup_key: string | null; metadata: Readonly<Record<string, string>> }) {
  return (
    (price.lookup_key !== null && LICENSE_LOOKUP_KEYS.includes(price.lookup_key)) ||
    price.metadata[LICENSE_METADATA.kind] === LICENSE_METADATA_KIND
  );
}

/**
 * The license item of a subscription. A server order has a server item and a license item until the
 * split moves the license to its own subscription, so no code reads the first item only.
 */
export function subscriptionLicenseItem(subscription: StripeSubscription): StripeSubscriptionItem | null {
  return subscription.items.data.find((item) => isLicensePrice(item.price)) ?? null;
}

/** The item of a subscription that is not the license: the server plan. */
export function subscriptionServerItem(subscription: StripeSubscription): StripeSubscriptionItem | null {
  return subscription.items.data.find((item) => !isLicensePrice(item.price)) ?? null;
}

/** The item that names the product of a subscription: the server plan when there is one, else the license. */
function subscriptionMainItem(subscription: StripeSubscription): StripeSubscriptionItem | null {
  return subscriptionServerItem(subscription) ?? subscriptionLicenseItem(subscription);
}

/** The subscription's period end in milliseconds, from the item or, for older API versions, the subscription. */
export function subscriptionPeriodEnd(subscription: StripeSubscription): number | null {
  const seconds = subscriptionMainItem(subscription)?.current_period_end ?? subscription.current_period_end;
  return seconds === undefined ? null : seconds * 1_000;
}

/**
 * The list price of one period in the subscription's currency, in minor units. A multi-currency Price
 * holds its base currency amount in `unit_amount` and the other currencies in `currency_options`.
 * Null for a Price with no fixed amount, such as a tiered Price.
 */
export function subscriptionAmount(subscription: StripeSubscription): number | null {
  const item = subscriptionMainItem(subscription);
  if (!item) return null;
  const currency = subscription.currency.toLowerCase();
  const unitAmount =
    item.price.currency.toLowerCase() === currency
      ? item.price.unit_amount
      : (item.price.currency_options?.[currency]?.unit_amount ?? null);
  if (unitAmount === null) return null;
  const amount = unitAmount * (item.quantity ?? 1);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

/** The ID of the subscription's default payment method, or null when it has none. */
export function subscriptionPaymentMethodId(subscription: StripeSubscription): string | null {
  const method = subscription.default_payment_method;
  if (!method) return null;
  return typeof method === "string" ? method : method.id;
}

/** The ID of the subscription's latest invoice, or null before its first invoice. */
export function subscriptionLatestInvoiceId(subscription: StripeSubscription): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice) return null;
  return typeof invoice === "string" ? invoice : invoice.id;
}

export function subscriptionCustomerId(subscription: StripeSubscription): string {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
}

/** Decodes a webhook body that `verifyStripeSignature` accepted. */
export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const parsed = Schema.decodeUnknownOption(eventSchema)(JSON.parse(payload));
    return Option.isSome(parsed) ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * Checks a `Stripe-Signature` header (`t=<seconds>,v1=<hex>[,v1=<hex>]`) against the raw body.
 * During a secret rotation Stripe sends one `v1` for each secret, so any match is enough.
 */
export const verifyStripeSignature = Effect.fn("verifyStripeSignature")(function* (
  payload: string,
  header: string | null,
  secret: string,
  now = Date.now(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
) {
  if (!header || !secret) return false;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "t") timestamp = value;
    else if (name === "v1" && /^[0-9a-f]{64}$/u.test(value)) signatures.push(value);
  }
  if (!timestamp || !/^\d{1,12}$/u.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1_000 - Number(timestamp)) > toleranceSeconds) return false;
  const key = yield* Effect.tryPromise({
    try: () => importHmacSha256Key(secret, "sign"),
    catch: () => new StripeTransportError({}),
  });
  const expected = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)),
      catch: () => new StripeTransportError({}),
    }),
  );
  let matched = false;
  for (const signature of signatures) {
    // Every candidate is compared in full, so the time does not show which one matched.
    if (constantTimeEqual(expected, hexToBytes(signature))) matched = true;
  }
  return matched;
});
