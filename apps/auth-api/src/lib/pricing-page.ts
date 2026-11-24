import { BILLING_PLANS, type BillingPlanId, billingListPrices, storageTierGb } from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan } from "@openbot/contracts/hosted-servers";

export const PRICING_ROUTE = "/pricing";

export const PRICING_SOCIAL_IMAGE_PATH = "/social/pricing.jpg";

export const SOLD_OUT_PLANS: ReadonlySet<BillingPlanId> = new Set<BillingPlanId>();

export const PRICING_PAGE_UPDATED_AT = "2026-11-14";

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

export function isEuCountry(country: string | undefined): boolean {
  return country !== undefined && EU_COUNTRIES.has(country.toUpperCase());
}

export interface PricingOffer {
  plans: readonly HostedServerCatalogPlan[];
  inEu: boolean;
  licenseTrialEnd?: number;
}

export const LIST_PRICE_PLANS: readonly HostedServerCatalogPlan[] = BILLING_PLANS.map((plan) => {
  const month = billingListPrices(plan.id, "month");
  const year = billingListPrices(plan.id, "year");
  const entry: HostedServerCatalogPlan = {
    id: plan.id,
    diskGb: storageTierGb(plan.id, 0),
    memberLimit: plan.memberLimit,
    relativeSpeed: plan.relativeSpeed,
    prices: {
      eur: { month: month.eur, year: year.eur },
      usd: { month: month.usd, year: year.usd },
      pln: { month: month.pln, year: year.pln },
    },
  };
  if (SOLD_OUT_PLANS.has(plan.id)) entry.soldOut = true;
  return entry;
});
