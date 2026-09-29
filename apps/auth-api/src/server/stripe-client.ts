import { BILLING_CURRENCIES, BILLING_METADATA, type BillingCurrency } from "@openbot/contracts/billing";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { z } from "zod";

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
export class StripeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly code: string | null,
  ) {
    super(`Stripe request failed with ${status} (${type ?? "unknown"}${code ? `/${code}` : ""}).`);
  }
}

const stripeErrorSchema = z.object({
  error: z.object({ type: z.string().optional(), code: z.string().optional() }),
});

const sessionSchema = z.object({ id: z.string(), url: z.string().nullable() });
const customerSchema = z.object({ id: z.string(), deleted: z.boolean().optional() });
const checkoutSessionSchema = z.object({
  id: z.string(),
  url: z.string().nullable(),
  status: z.string().nullable(),
  // Not expanded: the ID of the subscription that a paid page started.
  subscription: z.string().nullable().optional(),
});

export type StripeCheckoutSession = z.infer<typeof checkoutSessionSchema>;

const priceSchema = z.object({
  id: z.string(),
  lookup_key: z.string().nullable(),
  currency: z.string(),
  unit_amount: z.number().int().nullable(),
  // Present only when the request expands it.
  currency_options: z.record(z.string(), z.object({ unit_amount: z.number().int().nullable().optional() })).optional(),
});
export type StripePrice = z.infer<typeof priceSchema>;
const priceListSchema = z.object({ data: z.array(priceSchema) });

const subscriptionSchema = z.object({
  id: z.string(),
  customer: z.union([z.string(), z.object({ id: z.string() })]),
  status: z.string(),
  currency: z.string(),
  cancel_at_period_end: z.boolean(),
  // A cancel at a set time, for example from the Customer Portal. Null when no cancel is set.
  cancel_at: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
  // Before API version 2025-03-31 the period end was on the subscription; it is now on each item.
  current_period_end: z.number().int().optional(),
  items: z.object({
    data: z.array(
      z.object({
        current_period_end: z.number().int().optional(),
        quantity: z.number().int().optional(),
        price: z.object({
          id: z.string(),
          lookup_key: z.string().nullable(),
          // `stripe-bootstrap.ts` writes the plan here. It stays when a new Price takes the lookup key.
          metadata: z.record(z.string(), z.string()).default({}),
          currency: z.string(),
          unit_amount: z.number().int().nullable(),
          // Present only when the request expands it.
          currency_options: z
            .record(z.string(), z.object({ unit_amount: z.number().int().nullable().optional() }))
            .optional(),
        }),
      }),
    ),
  }),
});
export type StripeSubscription = z.infer<typeof subscriptionSchema>;

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number().int(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export type StripeEvent = z.infer<typeof eventSchema>;

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
  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    flow?: { type: "subscription_update" | "subscription_cancel"; subscriptionId: string };
  }): Promise<string> {
    const body = new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl });
    if (input.flow) {
      body.set("flow_data[type]", input.flow.type);
      body.set(`flow_data[${input.flow.type}][subscription]`, input.flow.subscriptionId);
      body.set("flow_data[after_completion][type]", "redirect");
      body.set("flow_data[after_completion][redirect][return_url]", input.returnUrl);
    }
    return requireSessionUrl(await this.request("POST", "/v1/billing_portal/sessions", body, sessionSchema));
  }

  /** The subscription, with the Price amount in each currency, so the plan's own currency has a price. */
  getSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const query = new URLSearchParams({ "expand[]": "items.data.price.currency_options" });
    return this.request(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}?${query}`,
      null,
      subscriptionSchema,
    );
  }

  /** The active Prices with these lookup keys, with the amount in each currency. */
  async listPricesByLookupKeys(lookupKeys: readonly string[]): Promise<StripePrice[]> {
    const query = new URLSearchParams({ active: "true", limit: "100" });
    for (const key of lookupKeys) query.append("lookup_keys[]", key);
    query.append("expand[]", "data.currency_options");
    return (await this.request("GET", `/v1/prices?${query}`, null, priceListSchema)).data;
  }

  /** The same idempotency key gives the same customer, so two requests at once make one customer. */
  async createCustomer(input: { userId: string; email: string }, idempotencyKey: string): Promise<string> {
    const body = new URLSearchParams({ email: input.email, [`metadata[${BILLING_METADATA.userId}]`]: input.userId });
    return (await this.request("POST", "/v1/customers", body, customerSchema, idempotencyKey)).id;
  }

  /**
   * True when the customer was deleted in Stripe. Stripe still returns a deleted customer, with
   * `deleted`. A customer of another Stripe account, or of test data that was reset, does not exist.
   */
  async isCustomerDeleted(customerId: string): Promise<boolean> {
    const path = `/v1/customers/${encodeURIComponent(customerId)}`;
    try {
      return (await this.request("GET", path, null, customerSchema)).deleted === true;
    } catch (error) {
      if (error instanceof StripeRequestError && error.status === 404) return true;
      throw error;
    }
  }

  /**
   * A subscription Checkout for one server. The metadata goes on the session and on the subscription, so
   * the webhook links the subscription to the account and the server. Each call makes a new page, so it
   * takes no idempotency key: the caller closes the previous page.
   */
  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    currency: BillingCurrency;
    userId: string;
    serverId: string;
    successUrl: string;
    cancelUrl: string;
    nowSeconds: number;
  }): Promise<{ id: string; url: string }> {
    const body = new URLSearchParams({
      mode: "subscription",
      customer: input.customerId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      currency: input.currency,
      // Card collection stays on, so a plan that a code discounts only at the start can still renew.
      allow_promotion_codes: "true",
      client_reference_id: input.serverId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: String(input.nowSeconds + CHECKOUT_LIFETIME_SECONDS),
    });
    for (const prefix of ["metadata", "subscription_data[metadata]"]) {
      body.set(`${prefix}[${BILLING_METADATA.userId}]`, input.userId);
      body.set(`${prefix}[${BILLING_METADATA.serverId}]`, input.serverId);
    }
    const session = await this.request("POST", "/v1/checkout/sessions", body, checkoutSessionSchema);
    return { id: session.id, url: requireSessionUrl(session) };
  }

  /**
   * Closes a Checkout page. Returns the page in its final status: `expired`, or `complete` for a page
   * that the user paid. Stripe refuses to expire a session that is not open, so the service then reads it.
   */
  async expireCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
    const path = `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`;
    try {
      return await this.request("POST", `${path}/expire`, new URLSearchParams(), checkoutSessionSchema);
    } catch (error) {
      if (!(error instanceof StripeRequestError) || error.status !== 400) throw error;
      return this.request("GET", path, null, checkoutSessionSchema);
    }
  }

  /** Cancels a subscription now. Stripe gives no refund and no credit for the rest of the period. */
  cancelSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.request("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, null, subscriptionSchema);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: URLSearchParams | null,
    schema: z.ZodType<T>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await this.fetcher(`${STRIPE_API_ORIGIN}${path}`, {
      method,
      headers,
      ...(body ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = stripeErrorSchema.safeParse(value);
      throw new StripeRequestError(
        response.status,
        parsed.success ? (parsed.data.error.type ?? null) : null,
        parsed.success ? (parsed.data.error.code ?? null) : null,
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new StripeRequestError(response.status, "invalid_response", null);
    return parsed.data;
  }
}

function requireSessionUrl(session: { url: string | null }): string {
  if (!session.url) throw new StripeRequestError(200, "invalid_response", "missing_url");
  return session.url;
}

/** The subscription's period end in milliseconds, from the item or, for older API versions, the subscription. */
export function subscriptionPeriodEnd(subscription: StripeSubscription): number | null {
  const seconds = subscription.items.data[0]?.current_period_end ?? subscription.current_period_end;
  return seconds === undefined ? null : seconds * 1_000;
}

/**
 * The list price of one period in the subscription's currency, in minor units. A multi-currency Price
 * holds its base currency amount in `unit_amount` and the other currencies in `currency_options`.
 * Null for a Price with no fixed amount, such as a tiered Price.
 */
export function subscriptionAmount(subscription: StripeSubscription): number | null {
  const item = subscription.items.data[0];
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

export function subscriptionCustomerId(subscription: StripeSubscription): string {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
}

/** Decodes a webhook body that `verifyStripeSignature` accepted. */
export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Checks a `Stripe-Signature` header (`t=<seconds>,v1=<hex>[,v1=<hex>]`) against the raw body.
 * During a secret rotation Stripe sends one `v1` for each secret, so any match is enough.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now = Date.now(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
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
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)),
  );
  let matched = false;
  for (const signature of signatures) {
    // Every candidate is compared in full, so the time does not show which one matched.
    if (constantTimeEqual(expected, hexBytes(signature))) matched = true;
  }
  return matched;
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
