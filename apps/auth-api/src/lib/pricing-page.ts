// The /pricing page: hosted servers and the license, as one order form. No JSX here, for the same
// reason `content-collection.ts` holds none.

import { BILLING_PLANS, billingListPrices } from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan } from "@openbot/contracts/hosted-servers";

export const PRICING_ROUTE = "/pricing";

/** The sitemap date of the page. Change it when its text changes. */
export const PRICING_PAGE_UPDATED_AT = "2026-10-23";

/** The EU member states, as the ISO 3166-1 alpha-2 codes of the `CF-IPCountry` header. */
const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** True for a `CF-IPCountry` value in the EU. A missing or unknown country is not in the EU. */
export function isEuCountry(country: string | undefined): boolean {
  return country !== undefined && EU_COUNTRIES.has(country.toUpperCase());
}

/** What the page sells: the server plans with their prices. */
export interface PricingOffer {
  plans: readonly HostedServerCatalogPlan[];
  /** A visitor in the EU sees "excl. VAT" beside the total. */
  inEu: boolean;
}

/**
 * The plans at their list prices. Stripe has the same amounts (`scripts/stripe-bootstrap.ts`), so the page
 * shows these when the Stripe catalog does not load, as on a preview Worker.
 */
export const LIST_PRICE_PLANS: readonly HostedServerCatalogPlan[] = BILLING_PLANS.map((plan) => {
  const month = billingListPrices(plan.id, "month");
  const year = billingListPrices(plan.id, "year");
  return {
    id: plan.id,
    diskGb: plan.storageGb,
    memberLimit: plan.memberLimit,
    relativeSpeed: plan.relativeSpeed,
    prices: {
      eur: { month: month.eur, year: year.eur },
      usd: { month: month.usd, year: year.usd },
      pln: { month: month.pln, year: year.pln },
    },
  };
});
