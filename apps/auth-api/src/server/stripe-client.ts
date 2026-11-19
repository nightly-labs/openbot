import {
  BILLING_CURRENCIES,
  BILLING_METADATA,
  type BillingCurrency,
  type BillingStorageTier,
  parseStorageTierPrice,
} from "@openbot/contracts/billing";
import { LICENSE_LOOKUP_KEYS, LICENSE_METADATA, LICENSE_METADATA_KIND } from "@openbot/contracts/license";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Option, Result, Schema } from "effect";
import type { CheckoutTax } from "./billing-tax";
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
 * request body or Stripe's own message, which can repeat customer data. `param` is the name of the
 * refused request parameter, never its value.
 */
export class StripeRequestError extends Schema.TaggedError<StripeRequestError>()("StripeRequestError", {
  status: Schema.Number,
  type: Schema.NullOr(Schema.String),
  code: Schema.NullOr(Schema.String),
  param: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {
  constructor(status: number, type: string | null, code: string | null, param: string | null = null) {
    super({
      status,
      type,
      code,
      param,
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
  error: Schema.Struct({
    type: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    param: Schema.optional(Schema.String),
  }),
});
const sessionSchema = Schema.Struct({ id: Schema.String, url: Schema.NullOr(Schema.String) });
const customerSchema = Schema.Struct({ id: Schema.String, deleted: Schema.optional(Schema.Boolean) });
const customerBalanceSchema = Schema.Struct({
  id: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  /** For each currency: below 0 is credit that Stripe takes off the next invoice in that currency. */
  invoice_credit_balance: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Number))),
});
const balanceTransactionSchema = Schema.Struct({ id: Schema.String });
const couponSchema = Schema.Struct({ id: Schema.String });
const taxIdSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  value: Schema.String,
  /** Stripe's own check of an EU VAT ID with VIES, for an ID that Checkout collected. */
  verification: Schema.optional(Schema.NullOr(Schema.Struct({ status: Schema.String }))),
});
type StripeTaxId = typeof taxIdSchema.Type;
const customerTaxSchema = Schema.Struct({
  id: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  address: Schema.optional(Schema.NullOr(Schema.Struct({ country: Schema.optional(Schema.NullOr(Schema.String)) }))),
  tax_exempt: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Metadata,
  tax_ids: Schema.optional(Schema.NullOr(Schema.Struct({ data: Schema.Array(taxIdSchema) }))),
});
const taxRateListSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, metadata: Metadata })),
});
const promotionCodeListSchema = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) });

/** The session metadata that records the VAT decision of a Checkout page (`billing-tax.ts`), for the webhook check. */
export const VAT_METADATA = {
  country: "openbot_vat_country",
  treatment: "openbot_vat_treatment",
} as const;

/**
 * The time (ISO 8601) when a consumer in the EU asked that the hosting service begin before the 14-day
 * withdrawal period ends. It is on the Checkout session and on the subscription, as the record of the request.
 */
export const EARLY_START_METADATA = "openbot_early_start_at";

/** The tax facts of a Stripe customer that decide the VAT of a new subscription. */
export interface StripeCustomerTax {
  /** A customer deleted in the Stripe Dashboard has no tax facts. */
  deleted: boolean;
  country: string | null;
  taxExempt: "none" | "exempt" | "reverse";
  metadata: Readonly<Record<string, string>>;
  taxIds: readonly StripeTaxId[];
}
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
  /** The time of the last cancel request. Stripe keeps it after a resume. */
  canceled_at: Schema.optional(Schema.NullOr(Schema.Int)),
  metadata: Metadata,
  current_period_end: Schema.optional(Schema.Int),
  /** The end of the trial. Stripe keeps it after the trial ends. */
  trial_end: Schema.optional(Schema.NullOr(Schema.Int)),
  discounts: Schema.optional(Schema.NullOr(Schema.Array(expandable))),
  latest_invoice: Schema.optional(Schema.NullOr(expandable)),
  /**
   * Stripe Tax on the invoices. Only subscriptions from the days when Checkout used Stripe Tax have it on;
   * `scripts/stripe-vat-migrate.ts` moves them to `default_tax_rates`.
   */
  automatic_tax: Schema.optional(Schema.Struct({ enabled: Schema.Boolean })),
  /** The VAT rate of each invoice. Empty for reverse charge and for a buyer outside the EU. */
  default_tax_rates: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String })))),
  default_payment_method: Schema.optional(Schema.NullOr(expandable)),
  items: Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        current_period_end: Schema.optional(Schema.Int),
        quantity: Schema.optional(Schema.Int),
        discounts: Schema.optional(Schema.NullOr(Schema.Array(expandable))),
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
/** The card part of a payment method or a charge. Only the fingerprint is read: it names the card number. */
const cardFingerprintSchema = Schema.optional(
  Schema.NullOr(Schema.Struct({ fingerprint: Schema.optional(Schema.NullOr(Schema.String)) })),
);
const paymentMethodListSchema = Schema.Struct({ data: Schema.Array(Schema.Struct({ card: cardFingerprintSchema })) });
const chargeListSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      payment_method_details: Schema.optional(Schema.NullOr(Schema.Struct({ card: cardFingerprintSchema }))),
    }),
  ),
});
/** `coupon` is the place of the coupon before API version 2025-09-30.clover, `source.coupon` after it. */
const subscriptionDiscountsSchema = Schema.Struct({
  status: Schema.String,
  discounts: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Union([
          Schema.String,
          Schema.Struct({
            id: Schema.String,
            coupon: Schema.optional(Schema.NullOr(expandable)),
            source: Schema.optional(
              Schema.NullOr(Schema.Struct({ coupon: Schema.optional(Schema.NullOr(expandable)) })),
            ),
          }),
        ]),
      ),
    ),
  ),
});
const invoicePaymentListSchema = Schema.Struct({ data: Schema.Array(Schema.Struct({ invoice: expandable })) });
const invoiceSchema = Schema.Struct({
  id: Schema.String,
  billing_reason: Schema.optional(Schema.NullOr(Schema.String)),
  total: Schema.optional(Schema.NullOr(Schema.Number)),
  total_excluding_tax: Schema.optional(Schema.NullOr(Schema.Number)),
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

/** The largest number of `lookup_keys[]` that Stripe takes in one Price list request. */
const PRICE_LOOKUP_KEYS_PER_REQUEST = 10;

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return isOneOf(BILLING_CURRENCIES, value);
}

/** True when the Price can be paid in `currency`: its base currency, or one of its currency options. */
export function priceHasCurrency(price: StripePrice, currency: BillingCurrency): boolean {
  return price.currency.toLowerCase() === currency || price.currency_options?.[currency] !== undefined;
}

/** The Checkout form with this discount. Stripe refuses a page with both a discount and the code field. */
function withDiscount(body: URLSearchParams, kind: "promotion_code" | "coupon", id: string): URLSearchParams {
  const form = new URLSearchParams(body);
  form.delete("allow_promotion_codes");
  form.set(`discounts[0][${kind}]`, id);
  return form;
}

/**
 * Stripe refused the promotion code for this order: another currency names the `discounts` parameter, and
 * the other restrictions give a `coupon_` or `promotion_code_` error code, such as
 * `promotion_code_amount_insufficient` or `coupon_applies_to_nothing`.
 */
function isRefusedPromotionCode(error: StripeRequestError | StripeTransportError): boolean {
  if (error._tag !== "StripeRequestError" || error.status !== 400) return false;
  return (
    error.param?.startsWith("discounts") === true ||
    error.code?.startsWith("coupon_") === true ||
    error.code?.startsWith("promotion_code_") === true
  );
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

  /**
   * Adds the storage add-on to a subscription, or moves its storage item to `priceId`. Stripe invoices the
   * prorated amount now and refuses the change when that payment fails (402), so a server never gets a
   * larger disk unpaid. The idempotency key makes a repeated request one change.
   */

  readonly setStorageItem = Effect.fn("StripeClient.setStorageItem")(function* (
    this: StripeClient,
    input: { subscriptionId: string; itemId: string | null; priceId: string },
    idempotencyKey: string,
  ): Effect.fn.Return<StripeSubscription, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({
      "items[0][price]": input.priceId,
      "items[0][quantity]": "1",
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      "expand[]": "items.data.price.currency_options",
    });
    if (input.itemId) body.set("items[0][id]", input.itemId);
    return yield* this.#requestEffect(
      "POST",
      `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      body,
      subscriptionSchema,
      idempotencyKey,
    );
  }).bind(this);

  /**
   * The active Prices with these lookup keys, with the amount in each currency. Stripe takes at most 10
   * lookup keys in one request, so a longer list is read in parts.
   */

  readonly listPricesByLookupKeys = Effect.fn("StripeClient.listPricesByLookupKeys")(function* (
    this: StripeClient,
    lookupKeys: readonly string[],
  ): Effect.fn.Return<StripePrice[], StripeRequestError | StripeTransportError> {
    const chunks: (readonly string[])[] = [];
    for (let start = 0; start < lookupKeys.length; start += PRICE_LOOKUP_KEYS_PER_REQUEST) {
      chunks.push(lookupKeys.slice(start, start + PRICE_LOOKUP_KEYS_PER_REQUEST));
    }
    // The requests run at the same time, so a cold catalog waits for one Stripe call, not one per chunk.
    const pages = yield* Effect.forEach(
      chunks,
      (keys) => {
        const query = new URLSearchParams({ active: "true", limit: "100" });
        for (const key of keys) query.append("lookup_keys[]", key);
        query.append("expand[]", "data.currency_options");
        return this.#requestEffect("GET", `/v1/prices?${query}`, null, priceListSchema);
      },
      { concurrency: "unbounded" },
    );
    return pages.flatMap((page) => page.data);
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

  /** The country, the tax exemption and the tax IDs of a customer. */

  readonly getCustomerTax = Effect.fn("StripeClient.getCustomerTax")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<StripeCustomerTax, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ "expand[]": "tax_ids" });
    const path = `/v1/customers/${encodeURIComponent(customerId)}?${query}`;
    const customer = yield* this.#requestEffect("GET", path, null, customerTaxSchema);
    const exempt = customer.tax_exempt;
    return {
      deleted: customer.deleted === true,
      country: customer.address?.country || null,
      taxExempt: exempt === "exempt" || exempt === "reverse" ? exempt : "none",
      metadata: customer.metadata,
      taxIds: customer.tax_ids?.data ?? [],
    };
  }).bind(this);

  /**
   * Sets the tax facts of a customer. A new `country` clears the rest of the old address, which belongs to
   * the old country; the next Checkout asks for the full address again. Metadata keys with an empty value
   * are removed.
   */

  readonly setCustomerTax = Effect.fn("StripeClient.setCustomerTax")(function* (
    this: StripeClient,
    customerId: string,
    input: {
      country?: string;
      taxExempt: "none" | "reverse";
      metadata: Readonly<Record<string, string>>;
    },
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({ tax_exempt: input.taxExempt });
    if (input.country) {
      body.set("address[country]", input.country);
      for (const field of ["line1", "line2", "city", "state", "postal_code"]) body.set(`address[${field}]`, "");
    }
    for (const [key, value] of Object.entries(input.metadata)) body.set(`metadata[${key}]`, value);
    yield* this.#requestEffect("POST", `/v1/customers/${encodeURIComponent(customerId)}`, body, customerSchema);
  }).bind(this);

  /** Adds an EU VAT ID to a customer. Stripe shows it on each invoice. */

  readonly addCustomerVatId = Effect.fn("StripeClient.addCustomerVatId")(function* (
    this: StripeClient,
    customerId: string,
    vatId: string,
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({ type: "eu_vat", value: vatId });
    yield* this.#requestEffect("POST", `/v1/customers/${encodeURIComponent(customerId)}/tax_ids`, body, taxIdSchema);
  }).bind(this);

  readonly deleteCustomerTaxId = Effect.fn("StripeClient.deleteCustomerTaxId")(function* (
    this: StripeClient,
    customerId: string,
    taxId: string,
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const path = `/v1/customers/${encodeURIComponent(customerId)}/tax_ids/${encodeURIComponent(taxId)}`;
    yield* this.#requestEffect("DELETE", path, null, deletedSchema);
  }).bind(this);

  /** The ID of the active Tax Rate with `metadata[key] = value`, or null when the account has none. */

  readonly findTaxRate = Effect.fn("StripeClient.findTaxRate")(function* (
    this: StripeClient,
    key: string,
    value: string,
  ): Effect.fn.Return<string | null, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ active: "true", limit: "100" });
    const rates = yield* this.#requestEffect("GET", `/v1/tax_rates?${query}`, null, taxRateListSchema);
    return rates.data.find((rate) => rate.metadata[key] === value)?.id ?? null;
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
      /**
       * The VAT of every invoice of the subscription (`checkoutTax`). `null` is a customer with no country
       * while the country is not required: Stripe Tax sets the VAT, as before the billing details step.
       */
      tax: CheckoutTax | null;
      /** The subscription is free until this time. Stripe refuses a time less than 48 hours away. */
      trialEndSeconds?: number;
      /** The code of a discount link (`promotion-code.ts`). Absent: the buyer can type a code in Checkout. */
      promotionCode?: string;
      /**
       * The invite discount of an account that signed up with an invite link (`ensureReferralCoupon`). A
       * promotion code that Stripe accepts goes first: Checkout takes one discount.
       */
      referralCouponId?: string;
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
      // `hosted` is the name of `hosted_page` before API version 2026-03-25.dahlia.
      ui_mode: "hosted",
      origin_context: "web",
      submit_type: "auto",
      payment_method_collection: "always",
      // The country and the VAT ID come before Checkout (`billing-tax.ts`), which gives `taxRateId`. Checkout
      // asks for the full address for the invoice and saves it on the customer, with the name.
      billing_address_collection: "required",
      "phone_number_collection[enabled]": "false",
      "customer_update[name]": "auto",
      "customer_update[address]": "auto",
      "consent_collection[terms_of_service]": "required",
      // No `name_collection[business]`: with it, Checkout hides the "I'm purchasing as a business"
      // checkbox, and thus the tax ID field, until the buyer types a business name.
      "name_collection[individual][enabled]": "true",
      "name_collection[individual][optional]": "true",
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
    if (input.tax) {
      // The rate goes on top of the Price. Reverse charge and a buyer outside the EU have no rate.
      if (input.tax.rateId) body.set("subscription_data[default_tax_rates][0]", input.tax.rateId);
      body.set(`metadata[${VAT_METADATA.country}]`, input.tax.country);
      body.set(`metadata[${VAT_METADATA.treatment}]`, input.tax.treatment);
      // The subscription keeps its VAT treatment, so that a change of the billing details changes only the
      // subscriptions that got their VAT from OpenBot (`billing-tax.ts`).
      body.set(`subscription_data[metadata][${VAT_METADATA.treatment}]`, input.tax.treatment);
    } else {
      // No country yet: Stripe Tax sets the VAT from the Checkout address and collects the VAT ID.
      // `scripts/stripe-vat-migrate.ts` later moves the subscription to the rate.
      body.set("automatic_tax[enabled]", "true");
      body.set("tax_id_collection[enabled]", "true");
      body.set("tax_id_collection[required]", "never");
    }
    for (const prefix of ["metadata", "subscription_data[metadata]"]) {
      body.set(`${prefix}[${BILLING_METADATA.userId}]`, input.userId);
      if (input.serverId) body.set(`${prefix}[${BILLING_METADATA.serverId}]`, input.serverId);
      for (const [key, value] of Object.entries(input.metadata ?? {})) body.set(`${prefix}[${key}]`, value);
    }
    for (const [key, value] of Object.entries(input.sessionMetadata ?? {})) body.set(`metadata[${key}]`, value);
    const create = (form: URLSearchParams) =>
      this.#requestEffect("POST", "/v1/checkout/sessions", form, checkoutSessionSchema);
    // The code of a discount link is optional: when Stripe cannot find it, the page has the code field.
    const promotionCodeId = input.promotionCode
      ? yield* this.#activePromotionCodeId(input.promotionCode).pipe(Effect.orElseSucceed(() => null))
      : null;
    // Without a promotion code, the invite discount. Stripe refuses a page with both a discount and the
    // code field, so the page then has no code field.
    const fallback = input.referralCouponId ? withDiscount(body, "coupon", input.referralCouponId) : body;
    const session = yield* promotionCodeId
      ? // A code whose restrictions this order does not meet (a first order only, a minimum amount, other
        // products or another currency) gives the page with the code field instead.
        create(withDiscount(body, "promotion_code", promotionCodeId)).pipe(
          Effect.catchIf(isRefusedPromotionCode, () => create(fallback)),
        )
      : create(fallback);
    if (!session.url) return yield* new StripeRequestError(200, "invalid_response", "missing_url");
    return { id: session.id, url: session.url };
  }).bind(this);

  /** The ID of the active promotion code with this code, or null when Stripe has none. */

  readonly #activePromotionCodeId = Effect.fn("StripeClient.activePromotionCodeId")(function* (
    this: StripeClient,
    code: string,
  ): Effect.fn.Return<string | null, StripeRequestError | StripeTransportError> {
    const query = new URLSearchParams({ code, active: "true", limit: "1" });
    const codes = yield* this.#requestEffect("GET", `/v1/promotion_codes?${query}`, null, promotionCodeListSchema);
    return codes.data[0]?.id ?? null;
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
      /**
       * Stripe Tax on the invoices, as on the subscription that this one comes from. Sent only when true, so
       * the retry of a split that started before Stripe Tax keeps the body of its idempotency key.
       */
      automaticTax: boolean;
      /**
       * The VAT rates of the invoices, as on the subscription that this one comes from. Sent only when there
       * is one, so the retry of an older split keeps the body of its idempotency key.
       */
      taxRateIds: readonly string[];
      paymentMethodId: string | null;
      /**
       * A coupon on each invoice, such as the invite discount. Sent only when there is one, so the retry of
       * an older split keeps the body of its idempotency key.
       */
      couponId?: string;
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
    if (input.automaticTax) body.set("automatic_tax[enabled]", "true");
    for (const [index, id] of input.taxRateIds.entries()) body.set(`default_tax_rates[${index}]`, id);
    if (input.paymentMethodId) body.set("default_payment_method", input.paymentMethodId);
    if (input.couponId) body.set("discounts[0][coupon]", input.couponId);
    for (const [key, value] of Object.entries(input.metadata)) body.set(`metadata[${key}]`, value);
    return yield* this.#requestEffect("POST", "/v1/subscriptions", body, subscriptionSchema, idempotencyKey);
  }).bind(this);

  /** Sets the VAT rates of the next invoices of a subscription and its VAT treatment. No rate removes them. */

  readonly setSubscriptionTaxRates = Effect.fn("StripeClient.setSubscriptionTaxRates")(function* (
    this: StripeClient,
    subscriptionId: string,
    rateIds: readonly string[],
    treatment: string,
  ): Effect.fn.Return<void, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({ [`metadata[${VAT_METADATA.treatment}]`]: treatment });
    if (rateIds.length === 0) body.set("default_tax_rates", "");
    for (const [index, id] of rateIds.entries()) body.set(`default_tax_rates[${index}]`, id);
    yield* this.#requestEffect(
      "POST",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      body,
      subscriptionSchema,
    );
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
   * The invoice that a PaymentIntent paid, the subscription of that invoice, why Stripe made it, and its
   * total with and without tax. Null for a payment of no subscription invoice. From API version
   * 2025-03-31 a charge does not name its invoice.
   */

  readonly getPaymentInvoice = Effect.fn("StripeClient.getPaymentInvoice")(function* (
    this: StripeClient,
    paymentIntentId: string,
  ): Effect.fn.Return<
    {
      invoiceId: string;
      subscriptionId: string;
      billingReason: string | null;
      total: number | null;
      totalExcludingTax: number | null;
    } | null,
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
      total: invoiceRecord.total ?? null,
      totalExcludingTax: invoiceRecord.total_excluding_tax ?? null,
    };
  }).bind(this);

  /**
   * The currency of a customer, and its credit for each currency in minor units (above 0). Null for a
   * customer that was deleted. In `invoice_credit_balance` a credit is above 0, unlike `balance`, where a
   * credit is below 0.
   */
  readonly getCustomerCredit = Effect.fn("StripeClient.getCustomerCredit")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<
    { currency: string | null; credit: Readonly<Record<string, number>> } | null,
    StripeRequestError | StripeTransportError
  > {
    const query = new URLSearchParams({ "expand[]": "invoice_credit_balance" });
    const path = `/v1/customers/${encodeURIComponent(customerId)}?${query}`;
    const customer = yield* this.#requestEffect("GET", path, null, customerBalanceSchema);
    if (customer.deleted) return null;
    const credit: Record<string, number> = {};
    for (const [currency, balance] of Object.entries(customer.invoice_credit_balance ?? {})) {
      if (Number.isSafeInteger(balance) && balance > 0) credit[currency.toLowerCase()] = balance;
    }
    return { currency: customer.currency?.toLowerCase() ?? null, credit };
  }).bind(this);

  /**
   * Changes the credit of a customer in one currency: a negative amount adds credit, which Stripe takes off
   * the next invoice in that currency, and a positive amount takes credit back. The idempotency key makes a
   * retry change nothing.
   */

  readonly addCustomerBalance = Effect.fn("StripeClient.addCustomerBalance")(function* (
    this: StripeClient,
    input: { customerId: string; amount: number; currency: string; description: string },
    idempotencyKey: string,
  ): Effect.fn.Return<string, StripeRequestError | StripeTransportError> {
    const body = new URLSearchParams({
      amount: String(input.amount),
      currency: input.currency,
      description: input.description,
    });
    const path = `/v1/customers/${encodeURIComponent(input.customerId)}/balance_transactions`;
    return (yield* this.#requestEffect("POST", path, body, balanceTransactionSchema, idempotencyKey)).id;
  }).bind(this);

  /**
   * Makes the coupon of the invite discount when the Stripe account does not have it. The ID is fixed, so
   * a second call finds the first coupon.
   */

  readonly ensureReferralCoupon = Effect.fn("StripeClient.ensureReferralCoupon")(function* (
    this: StripeClient,
    input: { id: string; percentOff: number; name: string },
  ): Effect.fn.Return<string, StripeRequestError | StripeTransportError> {
    const path = `/v1/coupons/${encodeURIComponent(input.id)}`;
    const found = yield* Effect.result(this.#requestEffect("GET", path, null, couponSchema));
    if (Result.isSuccess(found)) return found.success.id;
    if (!(found.failure instanceof StripeRequestError) || found.failure.status !== 404) return yield* found.failure;
    const body = new URLSearchParams({
      id: input.id,
      percent_off: String(input.percentOff),
      duration: "forever",
      name: input.name,
    });
    return (yield* this.#requestEffect("POST", "/v1/coupons", body, couponSchema, `openbot-coupon-${input.id}`)).id;
  }).bind(this);

  /**
   * The fingerprints of the cards of a customer: the saved cards and the cards of its last 100 charges. Two
   * customers with the same fingerprint used the same card number.
   */
  readonly cardFingerprints = Effect.fn("StripeClient.cardFingerprints")(function* (
    this: StripeClient,
    customerId: string,
  ): Effect.fn.Return<ReadonlySet<string>, StripeRequestError | StripeTransportError> {
    const methods = new URLSearchParams({ customer: customerId, type: "card", limit: "100" });
    const charges = new URLSearchParams({ customer: customerId, limit: "100" });
    const [saved, paid] = yield* Effect.all(
      [
        this.#requestEffect("GET", `/v1/payment_methods?${methods}`, null, paymentMethodListSchema),
        this.#requestEffect("GET", `/v1/charges?${charges}`, null, chargeListSchema),
      ],
      { concurrency: 2 },
    );
    const fingerprints = new Set<string>();
    for (const method of saved.data) if (method.card?.fingerprint) fingerprints.add(method.card.fingerprint);
    for (const charge of paid.data) {
      const fingerprint = charge.payment_method_details?.card?.fingerprint;
      if (fingerprint) fingerprints.add(fingerprint);
    }
    return fingerprints;
  }).bind(this);

  /**
   * Takes one coupon off a subscription and keeps its other discounts. False when the subscription did not
   * have the coupon or has ended.
   */
  readonly removeSubscriptionCoupon = Effect.fn("StripeClient.removeSubscriptionCoupon")(function* (
    this: StripeClient,
    subscriptionId: string,
    couponId: string,
  ): Effect.fn.Return<boolean, StripeRequestError | StripeTransportError> {
    const path = `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
    const query = new URLSearchParams({ "expand[]": "discounts" });
    const subscription = yield* this.#requestEffect("GET", `${path}?${query}`, null, subscriptionDiscountsSchema);
    if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return false;
    const discounts = subscription.discounts ?? [];
    const idOf = (value: string | { id: string } | null | undefined) =>
      typeof value === "string" ? value : (value?.id ?? null);
    const keep = discounts
      .filter(
        (discount) => typeof discount === "string" || idOf(discount.source?.coupon ?? discount.coupon) !== couponId,
      )
      .map((discount) => (typeof discount === "string" ? discount : discount.id));
    if (keep.length === discounts.length) return false;
    const body = new URLSearchParams();
    // An empty value removes all discounts.
    if (keep.length === 0) body.set("discounts", "");
    for (const [index, id] of keep.entries()) body.set(`discounts[${index}][discount]`, id);
    yield* this.#requestEffect("POST", path, body, subscriptionDiscountsSchema);
    return true;
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
        Option.isSome(parsed) ? (parsed.value.error.param ?? null) : null,
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

/** True for a Price of the storage add-on of a hosted server. */
function isStoragePrice(price: { lookup_key: string | null; metadata: Readonly<Record<string, string>> }) {
  return parseStorageTierPrice(price) !== null;
}

/** The item of a subscription that is not the license or the storage add-on: the server plan. */
export function subscriptionServerItem(subscription: StripeSubscription): StripeSubscriptionItem | null {
  return subscription.items.data.find((item) => !isLicensePrice(item.price) && !isStoragePrice(item.price)) ?? null;
}

/** The storage add-on item of a server plan, or null when the server has the plan storage only. */
export function subscriptionStorageItem(subscription: StripeSubscription): StripeSubscriptionItem | null {
  return subscription.items.data.find((item) => isStoragePrice(item.price)) ?? null;
}

/** The storage tier that a subscription pays for: the tier of its storage item, or 0 with no such item. */
export function subscriptionStorageTier(subscription: StripeSubscription): BillingStorageTier {
  const item = subscriptionStorageItem(subscription);
  return item ? (parseStorageTierPrice(item.price)?.tier ?? 0) : 0;
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
 * The list price of one period in the subscription's currency, in minor units: the plan, and the storage
 * add-on of a server plan. A multi-currency Price holds its base currency amount in `unit_amount` and the
 * other currencies in `currency_options`. Null for a Price with no fixed amount, such as a tiered Price.
 */
export function subscriptionAmount(subscription: StripeSubscription): number | null {
  const item = subscriptionMainItem(subscription);
  if (!item) return null;
  const currency = subscription.currency.toLowerCase();
  const storage = subscriptionServerItem(subscription) ? subscriptionStorageItem(subscription) : null;
  let amount = 0;
  for (const part of storage ? [item, storage] : [item]) {
    const partAmount = itemAmount(part, currency);
    if (partAmount === null) return null;
    amount += partAmount;
  }
  return Number.isSafeInteger(amount) ? amount : null;
}

function itemAmount(item: StripeSubscriptionItem, currency: string): number | null {
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
