import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  BILLING_SUBSCRIPTION_STATUSES,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  isStripeCheckoutUrl,
} from "./billing";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type LicenseTier = "starter" | "team";
export const LICENSE_TIERS: readonly LicenseTier[] = ["starter", "team"];

export interface LicensePlan {
  tier: LicenseTier;
  interval: BillingInterval;
  bundle: boolean;
}

export const LICENSE_PLANS: readonly LicensePlan[] = LICENSE_TIERS.flatMap((tier) =>
  BILLING_INTERVALS.flatMap((interval) => [false, true].map((bundle) => ({ tier, interval, bundle }))),
);

export const LICENSE_LOOKUP_KEY = "openbot_license_month";

export function licenseLookupKey(plan: LicensePlan): string {
  const bundle = plan.bundle ? "bundle_" : "";
  return plan.tier === "team"
    ? `openbot_license_${bundle}${plan.interval}`
    : `openbot_license_starter_${bundle}${plan.interval}`;
}

export const LICENSE_LOOKUP_KEYS: readonly string[] = LICENSE_PLANS.map(licenseLookupKey);
export const LICENSE_PRODUCT_ID = "openbot_license";
export const LICENSE_METADATA = {
  kind: "openbot_kind",
  paidUsers: "openbot_paid_users",
  paidPeriodEnd: "openbot_paid_period_end",
  tier: "openbot_license_tier",
  interval: "openbot_license_interval",
  bundle: "openbot_license_bundle",
  orderSubscription: "openbot_order_subscription",
} as const;
export const LICENSE_METADATA_KIND = "license";

export const ORDER_METADATA = {
  licenseTier: "openbot_order_license_tier",
  licenseUsers: "openbot_order_license_users",
  licenseInterval: "openbot_order_license_interval",
  licenseTrialEnd: "openbot_order_license_trial_end",
} as const;

export const LICENSE_INCLUDED_USERS = 2;
export const LICENSE_MAX_USERS = 25;
export const LICENSE_SITES_PER_USER = 3;
export const LICENSE_DEVICES_PER_USER = 3;
export const LICENSE_YEAR_DISCOUNT_PERCENT = 20;
export const LICENSE_BUNDLE_DISCOUNT_PERCENT = 10;

export interface LicensePrice {
  base: number;
  extraUser: number;
}

export const LICENSE_STARTER_MONTHLY: Readonly<Record<BillingCurrency, number>> = {
  eur: 1_000,
  usd: 1_200,
  pln: 4_000,
  brl: 4_200,
};

export const LICENSE_PRICES: Readonly<Record<BillingCurrency, LicensePrice>> = {
  eur: { base: 2_500, extraUser: 1_500 },
  usd: { base: 3_000, extraUser: 1_800 },
  pln: { base: 10_000, extraUser: 6_000 },
  brl: { base: 15_000, extraUser: 9_000 },
};

function percentOff(amount: number, percent: number): number {
  return Math.round((amount * (100 - percent)) / 100);
}

export function licenseMonthlyPrice(month: number, interval: BillingInterval): number {
  return interval === "month" ? month : percentOff(month, LICENSE_YEAR_DISCOUNT_PERCENT);
}

type LicensePlanKey = `${LicenseTier}_${"" | "bundle_"}${BillingInterval}`;

function licensePlanKey(plan: LicensePlan): LicensePlanKey {
  return `${plan.tier}_${plan.bundle ? "bundle_" : ""}${plan.interval}`;
}

export const LICENSE_PLAN_PRICES: Readonly<Record<LicensePlanKey, Readonly<Record<BillingCurrency, LicensePrice>>>> = {
  starter_month: {
    eur: { base: 1_000, extraUser: 0 },
    usd: { base: 1_200, extraUser: 0 },
    pln: { base: 4_000, extraUser: 0 },
    brl: { base: 4_200, extraUser: 0 },
  },
  starter_year: {
    eur: { base: 9_600, extraUser: 0 },
    usd: { base: 11_520, extraUser: 0 },
    pln: { base: 38_400, extraUser: 0 },
    brl: { base: 40_320, extraUser: 0 },
  },
  starter_bundle_month: {
    eur: { base: 900, extraUser: 0 },
    usd: { base: 1_080, extraUser: 0 },
    pln: { base: 3_600, extraUser: 0 },
    brl: { base: 3_780, extraUser: 0 },
  },
  starter_bundle_year: {
    eur: { base: 8_640, extraUser: 0 },
    usd: { base: 10_368, extraUser: 0 },
    pln: { base: 34_560, extraUser: 0 },
    brl: { base: 36_288, extraUser: 0 },
  },
  team_month: LICENSE_PRICES,
  team_year: {
    eur: { base: 24_000, extraUser: 14_400 },
    usd: { base: 28_800, extraUser: 17_280 },
    pln: { base: 96_000, extraUser: 57_600 },
    brl: { base: 144_000, extraUser: 86_400 },
  },
  team_bundle_month: {
    eur: { base: 2_250, extraUser: 1_350 },
    usd: { base: 2_700, extraUser: 1_620 },
    pln: { base: 9_000, extraUser: 5_400 },
    brl: { base: 13_500, extraUser: 8_100 },
  },
  team_bundle_year: {
    eur: { base: 21_600, extraUser: 12_960 },
    usd: { base: 25_920, extraUser: 15_552 },
    pln: { base: 86_400, extraUser: 51_840 },
    brl: { base: 129_600, extraUser: 77_760 },
  },
};

export function licenseIncludedUsers(tier: LicenseTier) {
  return tier === "team" ? LICENSE_INCLUDED_USERS : 1;
}

export function licenseMaxUsers(tier: LicenseTier) {
  return tier === "team" ? LICENSE_MAX_USERS : 1;
}

export const LICENSE_MONTHLY_CREDITS: Readonly<Record<LicenseTier, { base: number; extraUser: number }>> = {
  starter: { base: 50, extraUser: 0 },
  team: { base: 100, extraUser: 50 },
};

export function licenseMonthlyCredits(tier: LicenseTier, users: number): number {
  const credits = LICENSE_MONTHLY_CREDITS[tier];
  return credits.base + Math.max(0, users - 1) * credits.extraUser;
}

export function licensePlanPrice(plan: LicensePlan, currency: BillingCurrency): LicensePrice {
  return LICENSE_PLAN_PRICES[licensePlanKey(plan)][currency];
}

export function licensePeriodAmount(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const price = licensePlanPrice(plan, currency);
  return price.base + Math.max(0, users - licenseIncludedUsers(plan.tier)) * price.extraUser;
}

export function licenseMonthlyAmount(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const amount = licensePeriodAmount(plan, users, currency);
  return plan.interval === "year" ? Math.round(amount / 12) : amount;
}

export function licenseListMonthly(tier: LicenseTier, users: number, currency: BillingCurrency): number {
  return tier === "starter" ? LICENSE_STARTER_MONTHLY[currency] : licenseAmount(users, currency);
}

export function licenseOrderMonthly(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const month = licenseMonthlyPrice(licenseListMonthly(plan.tier, users, currency), plan.interval);
  return plan.bundle ? percentOff(month, LICENSE_BUNDLE_DISCOUNT_PERCENT) : month;
}

export function licenseAmount(users: number, currency: BillingCurrency): number {
  const price = LICENSE_PRICES[currency];
  return price.base + Math.max(0, users - LICENSE_INCLUDED_USERS) * price.extraUser;
}

export function isLicenseUserCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= LICENSE_INCLUDED_USERS && value <= LICENSE_MAX_USERS;
}

export function isLicenseTierUserCount(tier: LicenseTier, value: unknown): value is number {
  return tier === "team" ? isLicenseUserCount(value) : value === 1;
}

export function licensePlanFromPrice(price: {
  lookup_key: string | null;
  metadata: Readonly<Record<string, string>>;
}): LicensePlan {
  const tier = price.metadata[LICENSE_METADATA.tier];
  const interval = price.metadata[LICENSE_METADATA.interval];
  if (isOneOf(LICENSE_TIERS, tier) && isOneOf(BILLING_INTERVALS, interval))
    return { tier, interval, bundle: price.metadata[LICENSE_METADATA.bundle] === "true" };
  return (
    LICENSE_PLANS.find((plan) => licenseLookupKey(plan) === price.lookup_key) ?? {
      tier: "team",
      interval: "month",
      bundle: false,
    }
  );
}

export function licensePlanOf(license: {
  tier?: LicenseTier;
  interval?: BillingInterval;
  bundle?: boolean;
}): LicensePlan {
  return { tier: license.tier ?? "team", interval: license.interval ?? "month", bundle: license.bundle ?? false };
}

export interface LicenseOrder {
  tier: LicenseTier;
  users: number;
}

export function licenseOrderFor(people: number): LicenseOrder {
  return people === 1
    ? { tier: "starter", users: 1 }
    : { tier: "team", users: Math.max(LICENSE_INCLUDED_USERS, people) };
}

export function stepLicenseUsers(users: number, delta: 1 | -1): number {
  return Math.max(1, users + delta);
}

export interface License {
  subscriptionId: string;
  users: number;
  currency: BillingCurrency;
  amount: number;
  tier?: LicenseTier;
  interval?: BillingInterval;
  bundle?: boolean;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface LicenseUser {
  name: string | null;
  email: string;
  servers: string[];
  owner: boolean;
}

export interface LicenseCoverage {
  ownerName: string | null;
  ownerEmail: string;
}

export interface LicenseState {
  available: boolean;
  currency: BillingCurrency | null;
  license: License | null;
  used: number;
  users: LicenseUser[];
  coveredBy: LicenseCoverage[];
  bundle?: boolean;
  trialEnd?: number;
}

export interface LicenseCheckoutRequest {
  users: number;
  currency: BillingCurrency;
  tier?: LicenseTier;
  interval?: BillingInterval;
}

export interface LicensePlanRequest {
  interval: BillingInterval;
  users: number;
}

export interface LicenseUsersRequest {
  users: number;
}

export interface LicenseRenewalRequest {
  cancel: boolean;
}

export const LICENSE_UNAVAILABLE_STATE: LicenseState = {
  available: false,
  currency: null,
  license: null,
  used: 0,
  users: [],
  coveredBy: [],
};

const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,250}$/u;

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function parseLicense(value: unknown): License | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.subscriptionId) ||
    !SUBSCRIPTION_ID_PATTERN.test(value.subscriptionId) ||
    !isCount(value.users) ||
    !isOneOf(BILLING_CURRENCIES, value.currency) ||
    !isCount(value.amount) ||
    !isOneOf(BILLING_SUBSCRIPTION_STATUSES, value.status) ||
    !(value.currentPeriodEnd === null || isNumber(value.currentPeriodEnd)) ||
    !isBoolean(value.cancelAtPeriodEnd)
  ) {
    return null;
  }
  return {
    subscriptionId: value.subscriptionId,
    users: value.users,
    currency: value.currency,
    amount: value.amount,
    status: value.status,
    currentPeriodEnd: value.currentPeriodEnd,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    ...(isOneOf(LICENSE_TIERS, value.tier) ? { tier: value.tier } : {}),
    ...(isOneOf(BILLING_INTERVALS, value.interval) ? { interval: value.interval } : {}),
    ...(isBoolean(value.bundle) ? { bundle: value.bundle } : {}),
  };
}

export const LICENSE_TRIAL_DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "long", timeZone: "UTC" };

function parseLicenseUser(value: unknown): LicenseUser | null {
  if (
    !isDynamicRecord(value) ||
    !(value.name === null || isString(value.name)) ||
    !isString(value.email) ||
    !Array.isArray(value.servers) ||
    !value.servers.every(isString) ||
    !isBoolean(value.owner)
  ) {
    return null;
  }
  return { name: value.name, email: value.email, servers: [...value.servers], owner: value.owner };
}

function parseLicenseCoverage(value: unknown): LicenseCoverage | null {
  if (
    !isDynamicRecord(value) ||
    !(value.ownerName === null || isString(value.ownerName)) ||
    !isString(value.ownerEmail)
  )
    return null;
  return { ownerName: value.ownerName, ownerEmail: value.ownerEmail };
}

export function parseLicenseState(value: unknown): LicenseState | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !(value.currency === null || isOneOf(BILLING_CURRENCIES, value.currency)) ||
    !isCount(value.used) ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.coveredBy)
  ) {
    return null;
  }
  const license = value.license === null ? null : parseLicense(value.license);
  if (value.license !== null && !license) return null;
  const users: LicenseUser[] = [];
  for (const item of value.users) {
    const user = parseLicenseUser(item);
    if (user) users.push(user);
  }
  const coveredBy: LicenseCoverage[] = [];
  for (const item of value.coveredBy) {
    const coverage = parseLicenseCoverage(item);
    if (coverage) coveredBy.push(coverage);
  }
  return {
    available: value.available,
    currency: value.currency,
    license,
    used: value.used,
    users,
    coveredBy,
    ...(isBoolean(value.bundle) ? { bundle: value.bundle } : {}),
    ...(isNumber(value.trialEnd) && Number.isSafeInteger(value.trialEnd) ? { trialEnd: value.trialEnd } : {}),
  };
}

export function parseLicenseCheckoutRequest(value: unknown): Required<LicenseCheckoutRequest> | null {
  if (!isDynamicRecord(value) || !isOneOf(BILLING_CURRENCIES, value.currency)) return null;
  const tier = value.tier === undefined ? "team" : value.tier;
  const interval = value.interval === undefined ? "month" : value.interval;
  if (!isOneOf(LICENSE_TIERS, tier) || !isOneOf(BILLING_INTERVALS, interval)) return null;
  if (!isLicenseTierUserCount(tier, value.users)) return null;
  return { users: value.users, currency: value.currency, tier, interval };
}

export function parseLicensePlanRequest(value: unknown): LicensePlanRequest | null {
  if (!isDynamicRecord(value) || !isOneOf(BILLING_INTERVALS, value.interval) || !isLicenseUserCount(value.users))
    return null;
  return { interval: value.interval, users: value.users };
}

export function parseLicenseUsersRequest(value: unknown): LicenseUsersRequest | null {
  if (!isDynamicRecord(value) || !isLicenseUserCount(value.users)) return null;
  return { users: value.users };
}

export function parseLicenseRenewalRequest(value: unknown): LicenseRenewalRequest | null {
  if (!isDynamicRecord(value) || !isBoolean(value.cancel)) return null;
  return { cancel: value.cancel };
}

export function parseLicenseOrder(value: unknown): LicenseOrder | null {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(LICENSE_TIERS, value.tier) ||
    !isLicenseTierUserCount(value.tier, value.users)
  )
    return null;
  return { tier: value.tier, users: value.users };
}

export interface PricingOrder {
  server: BillingPlanId | null;
  license: LicenseOrder | null;
  interval: BillingInterval;
  currency: BillingCurrency;
}

export const PRICING_ORDER_PARAMS = ["plan", "license", "users", "interval", "currency"] as const;

export function pricingOrderSearch(
  order: PricingOrder,
): Partial<Record<(typeof PRICING_ORDER_PARAMS)[number], string | number>> {
  return {
    ...(order.server ? { plan: order.server } : {}),
    ...(order.license ? { license: order.license.tier, users: order.license.users } : {}),
    interval: order.interval,
    currency: order.currency,
  };
}

export function parsePricingOrder(params: URLSearchParams): PricingOrder | null {
  const plan = params.get("plan") || null;
  const tier = params.get("license") || null;
  const interval = params.get("interval");
  const currency = params.get("currency");
  if (!isOneOf(BILLING_INTERVALS, interval) || !isOneOf(BILLING_CURRENCIES, currency)) return null;
  if (plan !== null && !isOneOf(BILLING_PLAN_IDS, plan)) return null;
  const license = tier === null ? null : parseLicenseOrder({ tier, users: Number(params.get("users")) });
  if (tier !== null && license === null) return null;
  if (plan === null && license === null) return null;
  return { server: plan, license, interval, currency };
}

export function parseLicenseCheckoutUrl(value: unknown): string | null {
  return isDynamicRecord(value) && isStripeCheckoutUrl(value.url) ? value.url : null;
}
