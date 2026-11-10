import { BILLING_PLANS } from "@openbot/contracts/billing";
import { LICENSE_MAX_USERS } from "@openbot/contracts/license";
import type { AppTranslate } from "@openbot/i18n";

/*
 * The text of the pricing page around the order form, built from `sitePage.pricing.*` catalog keys. The order form
 * reads its own text from the catalog through `TextProvider`. This module has only a type import of the catalogs.
 */

/** The largest team that the page sells to. A larger team contacts sales. */
const PRICING_MAX_MEMBERS = Math.max(LICENSE_MAX_USERS, ...BILLING_PLANS.map((plan) => plan.memberLimit));

/** Private-use characters that mark where the two links go in the consent sentence of each language. */
export const CONSENT_POLICY_MARKER = "\uE000";
export const CONSENT_TERMS_MARKER = "\uE001";

export function pricingPageText(t: AppTranslate) {
  return {
    title: t("sitePage.pricing.title"),
    description: t("sitePage.pricing.description"),
    imageAlt: t("sitePage.pricing.imageAlt"),
    heading: t("sitePage.pricing.heading"),
    personal: {
      title: t("sitePage.pricing.personal.title"),
      body: t("sitePage.pricing.personal.body"),
      download: t("billing.order.cta.download"),
    },
    enterprise: {
      title: t("sitePage.pricing.enterprise.title"),
      body: t("sitePage.pricing.enterprise.body", { count: PRICING_MAX_MEMBERS }),
      contact: t("sitePage.pricing.enterprise.contact"),
    },
    consent: {
      statement: t("sitePage.pricing.consent.statement", {
        policy: CONSENT_POLICY_MARKER,
        terms: CONSENT_TERMS_MARKER,
      }),
      policy: t("sitePage.pricing.consent.policy"),
      terms: t("sitePage.pricing.consent.terms"),
    },
  };
}

export type PricingPageText = ReturnType<typeof pricingPageText>;
