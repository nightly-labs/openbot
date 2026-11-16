import { VAT_SELLER_COUNTRY, VAT_TAX_RATE } from "@openbot/contracts/billing-details";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";
import { billingDetailsOf, type VatTreatment, vatTreatment } from "../apps/auth-api/src/server/billing-tax";
import { STRIPE_API_VERSION, type StripeCustomerTax, VAT_METADATA } from "../apps/auth-api/src/server/stripe-client";

/**
 * One-off move of the open subscriptions from Stripe Tax to the Tax Rate of Polish VAT. Each subscription
 * with `automatic_tax` gets the VAT that a new Checkout page of its customer gets (`billing-tax.ts`):
 * the Tax Rate for `standard`, no rate for `reverse` and `none`. The customer's tax exemption follows, so
 * that the invoice of a reverse charge says so. The next invoice uses the new VAT; no invoice is made now.
 * The subscription also gets its VAT treatment in its metadata, so that a later change of the billing details
 * changes its rate as it does for a Checkout subscription.
 *
 *   STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-vat-migrate.ts [--apply] [--live]
 *
 * Without `--apply` it changes nothing and prints the plan. Without `--live` it refuses a live key. Run
 * `bun run api:stripe:bootstrap` first: it makes the Tax Rate. A subscription whose customer has no
 * country, or has an EU VAT ID of another country than Poland that no check confirmed, keeps Stripe Tax,
 * and the script names it for a manual check. Run it again at any time: a
 * subscription without `automatic_tax` is not changed.
 */

const logger = createOpenBotLogger("stripe-vat-migrate");
const OPEN_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

const taxRateListSchema = z.object({
  data: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.string()) })),
});
const subscriptionListSchema = z.object({
  has_more: z.boolean(),
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      customer: z.string(),
      automatic_tax: z.object({ enabled: z.boolean() }),
    }),
  ),
});
const customerSchema = z.object({
  id: z.string(),
  deleted: z.boolean().optional(),
  address: z.object({ country: z.string().nullable().optional() }).nullable().optional(),
  tax_exempt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  tax_ids: z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          value: z.string(),
          verification: z.object({ status: z.string() }).nullable().optional(),
        }),
      ),
    })
    .nullable()
    .optional(),
});
const idSchema = z.object({ id: z.string() });

async function stripe<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  body: URLSearchParams | null,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: body.toString() } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    // Stripe's message names the request parameter at fault. It holds no key.
    const error = z.object({ error: z.object({ message: z.string().optional() }) }).safeParse(value);
    throw new Error(
      `Stripe ${method} ${path.split("?")[0]} failed with ${response.status}: ${error.data?.error.message ?? "no message"}`,
    );
  }
  return schema.parse(value);
}

function customerTax(customer: z.infer<typeof customerSchema>): StripeCustomerTax {
  const exempt = customer.tax_exempt;
  return {
    deleted: customer.deleted === true,
    country: customer.address?.country || null,
    taxExempt: exempt === "exempt" || exempt === "reverse" ? exempt : "none",
    metadata: customer.metadata ?? {},
    taxIds: customer.tax_ids?.data ?? [],
  };
}

interface Plan {
  subscriptionId: string;
  customerId: string;
  country: string | null;
  treatment: VatTreatment | null;
  /** Why a subscription with no treatment needs a manual check. */
  reason: string;
}

async function main(args: readonly string[]): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Set STRIPE_SECRET_KEY to a Stripe secret key.");
  const live = args.includes("--live");
  const apply = args.includes("--apply");
  if (!live && !/^(sk|rk)_test_/u.test(secretKey))
    throw new Error("STRIPE_SECRET_KEY is not a test-mode key. Add --live to change live subscriptions.");

  const rates = await stripe(secretKey, "GET", "/v1/tax_rates?active=true&limit=100", null, taxRateListSchema);
  const rateId =
    rates.data.find((rate) => rate.metadata[VAT_TAX_RATE.metadataKey] === VAT_TAX_RATE.metadataValue)?.id ?? null;
  if (!rateId) throw new Error("The Tax Rate of Polish VAT is missing. Run bun run api:stripe:bootstrap first.");

  const customers = new Map<string, StripeCustomerTax>();
  const plans: Plan[] = [];
  let after: string | null = null;
  do {
    const query = new URLSearchParams({ status: "all", limit: "100" });
    if (after) query.set("starting_after", after);
    const page = await stripe(secretKey, "GET", `/v1/subscriptions?${query}`, null, subscriptionListSchema);
    for (const subscription of page.data) {
      if (!subscription.automatic_tax.enabled || !OPEN_STATUSES.has(subscription.status)) continue;
      let tax = customers.get(subscription.customer);
      if (!tax) {
        const path = `/v1/customers/${encodeURIComponent(subscription.customer)}?expand[]=tax_ids`;
        tax = customerTax(await stripe(secretKey, "GET", path, null, customerSchema));
        customers.set(subscription.customer, tax);
      }
      const details = billingDetailsOf(tax);
      const treatment = details.country ? vatTreatment(details.country, details.vatId !== null) : null;
      // Stripe Tax gave reverse charge for an EU VAT ID that Stripe could not verify. Such a company
      // keeps Stripe Tax until a person checks the ID, so that its next invoice does not add 23%.
      const unverifiedVatId =
        treatment === "standard" &&
        details.country !== VAT_SELLER_COUNTRY &&
        tax.taxIds.some((id) => id.type === "eu_vat");
      plans.push({
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        country: details.country,
        treatment: unverifiedVatId ? null : treatment,
        reason: unverifiedVatId ? "has an EU VAT ID that no check confirmed" : "has no billing country",
      });
    }
    after = page.has_more ? (page.data.at(-1)?.id ?? null) : null;
  } while (after);

  const counts = { standard: 0, reverse: 0, none: 0, manual: 0 };
  const exemptions = new Map<string, "none" | "reverse">();
  for (const plan of plans) {
    if (!plan.treatment) {
      counts.manual += 1;
      logger.warn(`${plan.subscriptionId}: customer ${plan.customerId} ${plan.reason}. It keeps Stripe Tax.`);
      continue;
    }
    counts[plan.treatment] += 1;
    logger.info(`${plan.subscriptionId}: ${plan.country} → ${plan.treatment}${apply ? "" : " (dry run)"}`);
    exemptions.set(plan.customerId, plan.treatment === "reverse" ? "reverse" : "none");
    if (!apply) continue;
    const body = new URLSearchParams({ "automatic_tax[enabled]": "false", proration_behavior: "none" });
    body.set(`metadata[${VAT_METADATA.treatment}]`, plan.treatment);
    if (plan.treatment === "standard") body.set("default_tax_rates[0]", rateId);
    else body.set("default_tax_rates", "");
    await stripe(secretKey, "POST", `/v1/subscriptions/${encodeURIComponent(plan.subscriptionId)}`, body, idSchema);
  }
  if (apply) {
    for (const [customerId, taxExempt] of exemptions) {
      if (customers.get(customerId)?.taxExempt === taxExempt) continue;
      const body = new URLSearchParams({ tax_exempt: taxExempt });
      await stripe(secretKey, "POST", `/v1/customers/${encodeURIComponent(customerId)}`, body, idSchema);
    }
  }
  logger.info(
    `${apply ? "Moved" : "Would move"} ${plans.length - counts.manual} subscriptions: ${counts.standard} standard, ` +
      `${counts.reverse} reverse charge, ${counts.none} outside the EU. Manual check: ${counts.manual}.`,
  );
}

if (import.meta.main) {
  void main(process.argv.slice(2)).catch((error) => {
    logger.error("Stripe VAT migration failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
