import { BILLING_PLANS } from "@openbot/contracts/billing";
import { LICENSE_MAX_USERS } from "@openbot/contracts/license";
import type { AppTranslate } from "@openbot/i18n";

/*
 * The text of the pricing page around the order form, built from `sitePage.pricing.*` catalog keys. The order form
 * reads its own text from the catalog through `TextProvider`. This module has only a type import of the catalogs.
 */

/** The largest team that the page sells to. A larger team contacts sales. */
const PRICING_MAX_MEMBERS = Math.max(LICENSE_MAX_USERS, ...BILLING_PLANS.map((plan) => plan.memberLimit));

export function pricingPageText(t: AppTranslate) {
  return {
    title: t("sitePage.pricing.title"),
    description: t("sitePage.pricing.description"),
    heading: t("sitePage.pricing.heading"),
    enterprise: {
      title: t("sitePage.pricing.enterprise.title"),
      body: t("sitePage.pricing.enterprise.body", { count: PRICING_MAX_MEMBERS }),
      contact: t("sitePage.pricing.enterprise.contact"),
    },
  };
}

export type PricingPageText = ReturnType<typeof pricingPageText>;
