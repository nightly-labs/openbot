import { type BillingPlanId, memberLimitForPlan } from "@openbot/contracts/billing";
import { LICENSE_INCLUDED_USERS } from "@openbot/contracts/license";
import { REFERRAL_CODE_MAX_AGE_DAYS } from "@openbot/contracts/referral";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { slot } from "./text-slots";

const REFERRAL_SLOTS = {
  name: slot("name"),
  percent: slot("percent"),
  amount: slot("amount"),
  price: slot("price"),
  size: slot("size"),
} as const;

const PLAN_NAME = {
  starter: "billing.plan.starter",
  standard: "billing.plan.standard",
  pro: "billing.plan.pro",
} as const satisfies Record<BillingPlanId, AppTextKey>;

function serverPlan(t: AppTranslate, plan: BillingPlanId) {
  return {
    name: t(PLAN_NAME[plan]),
    members: t("billing.order.memberCount", { count: memberLimitForPlan(plan) }),
  };
}

export function referralPageText(t: AppTranslate) {
  const { name, percent, amount, price, size } = REFERRAL_SLOTS;
  return {
    invitedBy: t("sitePage.referral.invitedBy", { name }),
    invited: t("sitePage.referral.invited"),
    offer: t("sitePage.referral.offer", { percent }),
    offerDetail: t("sitePage.referral.offerDetail"),
    lead: t("sitePage.referral.lead"),
    download: t("sitePage.site.downloadOpenBot"),
    browser: t("sitePage.join.browser"),
    card: {
      from: t("sitePage.referral.card.from", { name }),
      invite: t("sitePage.referral.card.invite"),
      offer: t("sitePage.referral.card.offer"),
      code: t("sitePage.referral.card.code"),
      copy: t("common.copy"),
      copied: t("common.copied"),
    },
    keep: t("sitePage.referral.keep", { count: REFERRAL_CODE_MAX_AGE_DAYS }),
    desktop: t("sitePage.referral.desktop"),
    prices: {
      title: t("sitePage.referral.prices.title", { percent }),
      description: t("sitePage.referral.prices.description"),
      billing: t("billing.order.billing"),
      monthly: t("billing.order.monthly"),
      yearly: t("billing.order.yearly"),
      firstMonth: t("sitePage.referral.prices.firstMonth", { amount }),
      firstYear: t("sitePage.referral.prices.firstYear", { amount }),
      note: t("sitePage.referral.prices.note", { currency: "EUR" }),
      all: t("sitePage.referral.prices.all"),
    },
    server: {
      title: t("billing.order.server.title"),
      body: t("billing.order.server.summary"),
      storage: t("billing.order.server.storage", { size }),
      plans: {
        starter: serverPlan(t, "starter"),
        standard: serverPlan(t, "standard"),
        pro: serverPlan(t, "pro"),
      } satisfies Record<BillingPlanId, ReturnType<typeof serverPlan>>,
    },
    license: {
      title: t("sitePage.landing.pricing.license"),
      body: t("billing.license.description"),
      starter: t("billing.order.license.starter"),
      starterDetail: t("billing.order.memberCount", { count: 1 }),
      team: t("billing.order.license.team"),
      teamDetail: t("billing.order.license.teamDetail", { included: LICENSE_INCLUDED_USERS, price }),
    },
  };
}

export type ReferralPageText = ReturnType<typeof referralPageText>;
