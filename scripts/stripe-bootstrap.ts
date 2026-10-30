import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  billingListPrices,
  billingLookupKey,
} from "@openbot/contracts/billing";
import {
  LICENSE_LOOKUP_KEYS,
  LICENSE_METADATA,
  LICENSE_METADATA_KIND,
  LICENSE_PLANS,
  LICENSE_PRODUCT_ID,
  type LicensePlan,
  type LicensePrice,
  licenseIncludedUsers,
  licenseLookupKey,
  licensePlanPrice,
} from "@openbot/contracts/license";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";

/**
 * Creates the Stripe catalog that the account server reads: one Product for each plan, and one Price
 * for each plan and interval with the lookup key `openbot_{plan}_{interval}`. It also creates the
 * license Product and one Price for each license plan (`LICENSE_PLANS`), and sets the Customer Portal
 * features. Run it again at any time: it changes only what differs.
 *
 *   STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-bootstrap.ts [--live] [--webhook-url <url>]
 *
 * Without `--live` it refuses a live key. `--webhook-url` creates or updates the webhook endpoint at
 * that URL. Stripe shows the signing secret of an endpoint only when it creates the endpoint, so the
 * script prints it one time, for STRIPE_WEBHOOK_SECRET. `bun run hosting:setup` calls
 * `bootstrapStripe` and stores the secret itself.
 */

const logger = createOpenBotLogger("stripe-bootstrap");
const STRIPE_API_VERSION = "2025-03-31.basil";

const PLAN_NAME: Record<BillingPlanId, string> = { starter: "Starter", standard: "Standard", pro: "Pro" };

/** The events that the webhook endpoint must receive. */
export const BILLING_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "invoice.paid",
  "invoice.payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;

const productSchema = z.object({ id: z.string(), active: z.boolean() });
const priceSchema = z.object({
  id: z.string(),
  product: z.string(),
  lookup_key: z.string().nullable(),
  currency: z.string(),
  unit_amount: z.number().int().nullable(),
  recurring: z.object({ interval: z.string() }).nullable(),
  currency_options: z.record(z.string(), z.object({ unit_amount: z.number().int().nullable() })).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
});
type Price = z.infer<typeof priceSchema>;
const priceListSchema = z.object({ data: z.array(priceSchema) });
const portalConfigurationListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const webhookEndpointSchema = z.object({ id: z.string(), url: z.string(), secret: z.string().optional() });
const webhookEndpointListSchema = z.object({ data: z.array(webhookEndpointSchema), has_more: z.boolean() });

class StripeAdmin {
  constructor(private readonly secretKey: string) {}

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: URLSearchParams | null,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      // Stripe's message names the request parameter at fault. It holds no key and no customer data here.
      const error = z.object({ error: z.object({ message: z.string().optional() }) }).safeParse(value);
      throw new Error(
        `Stripe ${method} ${path.split("?")[0]} failed with ${response.status}: ${error.data?.error.message ?? "no message"}`,
      );
    }
    return schema.parse(value);
  }

  async findProduct(id: string): Promise<z.infer<typeof productSchema> | null> {
    try {
      return await this.request("GET", `/v1/products/${id}`, null, productSchema);
    } catch (error) {
      if (error instanceof Error && error.message.includes("failed with 404")) return null;
      throw error;
    }
  }
}

function productId(plan: BillingPlanId): string {
  return `openbot_${plan}`;
}

async function ensureProduct(stripe: StripeAdmin, plan: BillingPlanId): Promise<void> {
  const id = productId(plan);
  const body = new URLSearchParams({
    name: `OpenBot ${PLAN_NAME[plan]}`,
    active: "true",
    "metadata[openbot_plan]": plan,
  });
  const existing = await stripe.findProduct(id);
  if (existing) {
    await stripe.request("POST", `/v1/products/${id}`, body, productSchema);
    logger.info(`Product ${id} is up to date.`);
    return;
  }
  body.set("id", id);
  await stripe.request("POST", "/v1/products", body, productSchema);
  logger.info(`Created product ${id}.`);
}

function priceMatches(
  price: Price,
  plan: BillingPlanId,
  interval: BillingInterval,
  amounts: Record<BillingCurrency, number>,
): boolean {
  return (
    price.product === productId(plan) &&
    price.currency === "eur" &&
    price.unit_amount === amounts.eur &&
    price.recurring?.interval === interval &&
    price.currency_options?.usd?.unit_amount === amounts.usd &&
    price.currency_options?.pln?.unit_amount === amounts.pln
  );
}

/**
 * A Stripe Price amount cannot change. When the amounts differ, this creates a new Price and moves the
 * lookup key to it. Current subscriptions keep the old Price until they change plan.
 */
async function ensurePrice(
  stripe: StripeAdmin,
  existing: readonly Price[],
  plan: BillingPlanId,
  interval: BillingInterval,
): Promise<string> {
  const lookupKey = billingLookupKey(plan, interval);
  const amounts = billingListPrices(plan, interval);
  const current = existing.find((price) => price.lookup_key === lookupKey);
  if (current && priceMatches(current, plan, interval, amounts)) {
    logger.info(`Price ${lookupKey} is up to date.`);
    return current.id;
  }
  const body = new URLSearchParams({
    product: productId(plan),
    currency: "eur",
    unit_amount: String(amounts.eur),
    "recurring[interval]": interval,
    lookup_key: lookupKey,
    transfer_lookup_key: "true",
    "currency_options[usd][unit_amount]": String(amounts.usd),
    "currency_options[pln][unit_amount]": String(amounts.pln),
    "metadata[openbot_plan]": plan,
    "metadata[openbot_interval]": interval,
  });
  const created = await stripe.request("POST", "/v1/prices", body, priceSchema);
  logger.info(`${current ? "Replaced" : "Created"} price ${lookupKey}.`);
  return created.id;
}

/** The amounts of a license plan as one metadata value, so a run can see that the Price is up to date. */
/** The amounts and the users of the base tier. A change of either makes a new Price. */
function licensePriceSignature(prices: Readonly<Record<string, LicensePrice>>, included: number): string {
  const amounts = Object.entries(prices)
    .map(([currency, price]) => `${currency}:${price.base}+${price.extraUser}`)
    .join(",");
  return `${amounts};${included}`;
}

async function ensureLicenseProduct(stripe: StripeAdmin): Promise<void> {
  const body = new URLSearchParams({
    name: "OpenBot commercial license",
    active: "true",
    [`metadata[${LICENSE_METADATA.kind}]`]: LICENSE_METADATA_KIND,
  });
  if (await stripe.findProduct(LICENSE_PRODUCT_ID)) {
    await stripe.request("POST", `/v1/products/${LICENSE_PRODUCT_ID}`, body, productSchema);
    logger.info(`Product ${LICENSE_PRODUCT_ID} is up to date.`);
    return;
  }
  body.set("id", LICENSE_PRODUCT_ID);
  await stripe.request("POST", "/v1/products", body, productSchema);
  logger.info(`Created product ${LICENSE_PRODUCT_ID}.`);
}

/**
 * The Price of one license plan. The quantity is the number of users. A Team Price is graduated tiers:
 * the first tier is the base amount for the included users, and the second tier is the amount of each
 * extra user. A 1-user Price is a flat amount for each user. A bundle Price is for an account that pays
 * for a hosted server. EUR is the base currency, and USD and PLN are currency options with their own
 * amounts. Only an active Price with the same amounts is kept, so
 * an archived Price stays archived and a new Price takes its lookup key.
 */
async function ensureLicensePrice(stripe: StripeAdmin, existing: readonly Price[], plan: LicensePlan): Promise<string> {
  const lookupKey = licenseLookupKey(plan);
  const prices = Object.fromEntries(
    BILLING_CURRENCIES.map((currency) => [currency, licensePlanPrice(plan, currency)] as const),
  );
  const bundle = String(plan.bundle);
  const included = licenseIncludedUsers(plan.tier);
  const signature = licensePriceSignature(prices, included);
  const current = existing.find((price) => price.lookup_key === lookupKey);
  if (
    current &&
    current.active !== false &&
    current.product === LICENSE_PRODUCT_ID &&
    current.currency === "eur" &&
    current.recurring?.interval === plan.interval &&
    current.metadata?.openbot_license_prices === signature &&
    current.metadata?.[LICENSE_METADATA.tier] === plan.tier &&
    current.metadata?.[LICENSE_METADATA.interval] === plan.interval &&
    current.metadata?.[LICENSE_METADATA.bundle] === bundle
  ) {
    logger.info(`Price ${lookupKey} is up to date.`);
    return current.id;
  }
  const body = new URLSearchParams({
    product: LICENSE_PRODUCT_ID,
    currency: "eur",
    "recurring[interval]": plan.interval,
    lookup_key: lookupKey,
    transfer_lookup_key: "true",
    [`metadata[${LICENSE_METADATA.kind}]`]: LICENSE_METADATA_KIND,
    [`metadata[${LICENSE_METADATA.tier}]`]: plan.tier,
    [`metadata[${LICENSE_METADATA.interval}]`]: plan.interval,
    [`metadata[${LICENSE_METADATA.bundle}]`]: bundle,
    "metadata[openbot_license_prices]": signature,
  });
  if (plan.tier === "team") {
    body.set("billing_scheme", "tiered");
    body.set("tiers_mode", "graduated");
  }
  for (const [currency, price] of Object.entries(prices)) {
    if (plan.tier !== "team") {
      body.set(currency === "eur" ? "unit_amount" : `currency_options[${currency}][unit_amount]`, String(price.base));
      continue;
    }
    const prefix = currency === "eur" ? "tiers" : `currency_options[${currency}][tiers]`;
    body.set(`${prefix}[0][up_to]`, String(included));
    body.set(`${prefix}[0][flat_amount]`, String(price.base));
    body.set(`${prefix}[0][unit_amount]`, "0");
    body.set(`${prefix}[1][up_to]`, "inf");
    body.set(`${prefix}[1][unit_amount]`, String(price.extraUser));
  }
  const created = await stripe.request("POST", "/v1/prices", body, priceSchema);
  logger.info(`${current ? "Replaced" : "Created"} price ${lookupKey}.`);
  return created.id;
}

/**
 * Portal sessions use the default configuration, and the API cannot create a default one. Stripe makes
 * it for the first Portal session, so this opens one session for a temporary customer and deletes it.
 */
async function defaultPortalConfiguration(stripe: StripeAdmin): Promise<string> {
  const find = async () =>
    (
      await stripe.request(
        "GET",
        "/v1/billing_portal/configurations?is_default=true&limit=1",
        null,
        portalConfigurationListSchema,
      )
    ).data[0]?.id ?? null;
  const existing = await find();
  if (existing) return existing;
  const customer = await stripe.request(
    "POST",
    "/v1/customers",
    new URLSearchParams({ description: "OpenBot bootstrap: creates the default Customer Portal configuration" }),
    z.object({ id: z.string() }),
  );
  try {
    await stripe.request(
      "POST",
      "/v1/billing_portal/sessions",
      new URLSearchParams({ customer: customer.id, return_url: "https://openbot.run" }),
      z.object({ id: z.string() }),
    );
  } finally {
    await stripe.request("DELETE", `/v1/customers/${customer.id}`, null, z.object({ id: z.string() }));
  }
  const created = await find();
  if (!created) throw new Error("Stripe did not create the default Customer Portal configuration.");
  logger.info("Created the default Customer Portal configuration.");
  return created;
}

async function updatePortalConfiguration(stripe: StripeAdmin, prices: Record<BillingPlanId, string[]>): Promise<void> {
  const configuration = { id: await defaultPortalConfiguration(stripe) };
  const body = new URLSearchParams({
    "features[invoice_history][enabled]": "true",
    "features[payment_method_update][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][enabled]": "true",
    // An upgrade gives the larger server now, so it is charged now. A downgrade or a shorter interval
    // starts at the next period, which the user already paid for.
    "features[subscription_update][proration_behavior]": "always_invoice",
    "features[subscription_update][schedule_at_period_end][conditions][0][type]": "decreasing_item_amount",
    "features[subscription_update][schedule_at_period_end][conditions][1][type]": "shortening_interval",
  });
  body.append("features[subscription_update][default_allowed_updates][]", "price");
  BILLING_PLAN_IDS.forEach((plan, index) => {
    body.set(`features[subscription_update][products][${index}][product]`, productId(plan));
    // One subscription pays for one server, so the quantity stays 1.
    body.set(`features[subscription_update][products][${index}][adjustable_quantity][enabled]`, "false");
    for (const price of prices[plan]) body.append(`features[subscription_update][products][${index}][prices][]`, price);
  });
  await stripe.request(
    "POST",
    `/v1/billing_portal/configurations/${configuration.id}`,
    body,
    z.object({ id: z.string() }),
  );
  logger.info("Updated the default Customer Portal configuration.");
}

/**
 * Returns the signing secret when this call created the endpoint, and null when it updated one. Stripe
 * cannot show the secret of an endpoint again, so `replace` deletes the endpoint and creates it again.
 */
async function ensureWebhookEndpoint(stripe: StripeAdmin, url: string, replace: boolean): Promise<string | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.pathname.endsWith("/v1/stripe/webhook")) {
    throw new Error("--webhook-url must be an https URL that ends with /v1/stripe/webhook.");
  }
  const body = new URLSearchParams({ url: parsed.href, description: "OpenBot account server" });
  for (const event of BILLING_WEBHOOK_EVENTS) body.append("enabled_events[]", event);
  let current: { id: string } | null = null;
  let startingAfter: string | null = null;
  for (;;) {
    const query = new URLSearchParams({ limit: "100", ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const page = await stripe.request("GET", `/v1/webhook_endpoints?${query}`, null, webhookEndpointListSchema);
    current = page.data.find((endpoint) => endpoint.url === parsed.href) ?? null;
    const last = page.data.at(-1);
    if (current || !page.has_more || !last) break;
    startingAfter = last.id;
  }
  if (current && !replace) {
    await stripe.request("POST", `/v1/webhook_endpoints/${current.id}`, body, webhookEndpointSchema);
    logger.info(`Webhook endpoint ${current.id} is up to date. Its signing secret did not change.`);
    return null;
  }
  body.set("api_version", STRIPE_API_VERSION);
  const created = await stripe.request("POST", "/v1/webhook_endpoints", body, webhookEndpointSchema);
  logger.info(`Created webhook endpoint ${created.id}.`);
  if (!created.secret) throw new Error("Stripe did not return the signing secret of the new webhook endpoint.");
  // The old endpoint goes only after the new one exists, so no event is made while no endpoint exists.
  // Stripe retries the deliveries that fail until the Worker has the new secret.
  if (current) {
    await stripe.request("DELETE", `/v1/webhook_endpoints/${current.id}`, null, z.object({ id: z.string() }));
    logger.info(`Deleted the old webhook endpoint ${current.id}.`);
  }
  return created.secret;
}

function optionValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}

export interface StripeBootstrapOptions {
  secretKey: string;
  /** Without it, a live key is refused. */
  live: boolean;
  /** The webhook endpoint to create or update, or null for none. */
  webhookUrl: string | null;
  /** Deletes the endpoint at `webhookUrl` and creates it again, for a new signing secret. */
  replaceWebhook?: boolean;
}

/** Returns the signing secret of the webhook endpoint when this call created it, else null. */
export async function bootstrapStripe(options: StripeBootstrapOptions): Promise<string | null> {
  const { secretKey, live, webhookUrl } = options;
  if (!live && !/^(sk|rk)_test_/u.test(secretKey)) {
    throw new Error("STRIPE_SECRET_KEY is not a test-mode key. Add --live to change the live catalog.");
  }
  const stripe = new StripeAdmin(secretKey);

  const lookupKeys = [
    ...BILLING_PLAN_IDS.flatMap((plan) => BILLING_INTERVALS.map((interval) => billingLookupKey(plan, interval))),
    ...LICENSE_LOOKUP_KEYS,
  ];
  const existing: Price[] = [];
  // Stripe accepts at most 10 lookup keys in one list request.
  for (let start = 0; start < lookupKeys.length; start += 10) {
    const query = new URLSearchParams({ limit: "100" });
    for (const key of lookupKeys.slice(start, start + 10)) query.append("lookup_keys[]", key);
    query.append("expand[]", "data.currency_options");
    existing.push(...(await stripe.request("GET", `/v1/prices?${query}`, null, priceListSchema)).data);
  }

  const prices: Record<BillingPlanId, string[]> = { starter: [], standard: [], pro: [] };
  for (const plan of BILLING_PLAN_IDS) {
    await ensureProduct(stripe, plan);
    for (const interval of BILLING_INTERVALS) prices[plan].push(await ensurePrice(stripe, existing, plan, interval));
  }

  for (const plan of BILLING_PLAN_IDS) logger.info(`Prices ${productId(plan)}: ${prices[plan].join(", ")}`);

  // The license is not in the Portal product list, so the Portal cannot change its users or price.
  await ensureLicenseProduct(stripe);
  for (const plan of LICENSE_PLANS)
    logger.info(`Price ${licenseLookupKey(plan)}: ${await ensureLicensePrice(stripe, existing, plan)}`);

  await updatePortalConfiguration(stripe, prices);
  return webhookUrl ? await ensureWebhookEndpoint(stripe, webhookUrl, options.replaceWebhook ?? false) : null;
}

async function main(args: readonly string[]): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Set STRIPE_SECRET_KEY to a Stripe secret key.");
  const webhookUrl = optionValue(args, "--webhook-url");
  const webhookSecret = await bootstrapStripe({ secretKey, live: args.includes("--live"), webhookUrl });
  const lines: string[] = [];
  if (webhookSecret) {
    // The operator asked for this secret, and Stripe never shows it again. Standard output only, not the log.
    process.stdout.write(`STRIPE_WEBHOOK_SECRET=${webhookSecret}\n`);
    lines.push("Put the STRIPE_WEBHOOK_SECRET line above in the env file of that Worker.");
  } else if (!webhookUrl) {
    lines.push(
      "Webhook endpoint: add --webhook-url <account server origin>/v1/stripe/webhook",
      "Local development: stripe listen --forward-to localhost:<port>/v1/stripe/webhook",
      "Put the signing secret in STRIPE_WEBHOOK_SECRET.",
    );
  }
  for (const line of lines) logger.info(line);
}

if (import.meta.main) {
  void main(process.argv.slice(2)).catch((error) => {
    logger.error("Stripe bootstrap failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
