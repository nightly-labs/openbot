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

/**
 * The commercial license: one Stripe subscription per account. Its quantity is the number of users.
 * People count, not servers or computers: the owner and each account that is an active member of a
 * server that the owner owns. AI agents and chat-app participants do not count.
 *
 * There are two tiers: Starter is 1 user, Team is 2 to 10 users. Each is monthly or yearly. An account
 * that pays for a hosted server (any plan) pays the bundle price, which is a percentage less.
 * The `/pricing` page and the app's order form show these prices; Stripe charges the same amounts.
 */

export type LicenseTier = "starter" | "team";
export const LICENSE_TIERS: readonly LicenseTier[] = ["starter", "team"];

/** One license Price: a tier, its billing interval, and the bundle price for an account with a server. */
export interface LicensePlan {
  tier: LicenseTier;
  interval: BillingInterval;
  bundle: boolean;
}

/** The plans that Stripe sells, one Price each. */
export const LICENSE_PLANS: readonly LicensePlan[] = LICENSE_TIERS.flatMap((tier) =>
  BILLING_INTERVALS.flatMap((interval) => [false, true].map((bundle) => ({ tier, interval, bundle }))),
);

/** The Stripe Price lookup key of the Team monthly license. A license from before the tiers uses it. */
export const LICENSE_LOOKUP_KEY = "openbot_license_month";

/** The Stripe Price lookup key of one license plan. `stripe-bootstrap.ts` creates them. */
export function licenseLookupKey(plan: LicensePlan): string {
  const bundle = plan.bundle ? "bundle_" : "";
  return plan.tier === "team"
    ? `openbot_license_${bundle}${plan.interval}`
    : `openbot_license_starter_${bundle}${plan.interval}`;
}

/** The lookup keys of all license Prices. */
export const LICENSE_LOOKUP_KEYS: readonly string[] = LICENSE_PLANS.map(licenseLookupKey);
/** The Stripe Product of the license. */
export const LICENSE_PRODUCT_ID = "openbot_license";
/**
 * The subscription metadata of a license. It names the account with `BILLING_METADATA.userId` and has
 * no server id, so a Worker that knows only server plans ignores it.
 */
export const LICENSE_METADATA = {
  kind: "openbot_kind",
  /**
   * The most users that Stripe invoiced in the period that ends at `paidPeriodEnd`. Fewer users apply
   * with no refund, so a later increase up to this count is already paid.
   */
  paidUsers: "openbot_paid_users",
  /** The end of the period that `paidUsers` is for, in milliseconds since the epoch. */
  paidPeriodEnd: "openbot_paid_period_end",
  /** The tier of a license Price. Not `openbot_plan`: the server plan sync reads that key. */
  tier: "openbot_license_tier",
  /** The billing interval of a license Price. */
  interval: "openbot_license_interval",
  /** "true" on a bundle Price. */
  bundle: "openbot_license_bundle",
  /**
   * On a license that a server order paid for: the subscription of the server and the license that the
   * customer paid in one Checkout. The split reads it so that it makes the license only once.
   */
  orderSubscription: "openbot_order_subscription",
} as const;
export const LICENSE_METADATA_KIND = "license";

/**
 * The license order of a server Checkout page. A later page for the same server reads it from the page
 * that it closes, so it sells the same license. A paid order normally has a license item, so the tier and
 * the users are on the session only. During a promotion the order has no license item: all keys are also
 * on the subscription, and the split makes a license that is free until `licenseTrialEnd`.
 */
export const ORDER_METADATA = {
  licenseTier: "openbot_order_license_tier",
  licenseUsers: "openbot_order_license_users",
  licenseInterval: "openbot_order_license_interval",
  licenseTrialEnd: "openbot_order_license_trial_end",
} as const;

/** The base price of the Team tier includes this many users. It is also the smallest Team license. */
export const LICENSE_INCLUDED_USERS = 2;
/** The largest license that the app sells. A larger team contacts sales. */
export const LICENSE_MAX_USERS = 10;
/** The license terms allow this many devices for each user. The app does not count them. */
export const LICENSE_DEVICES_PER_USER = 3;
/** Yearly billing takes this share off a license. The bundle discount comes off after it. */
export const LICENSE_YEAR_DISCOUNT_PERCENT = 20;
/** A license of an account that pays for a hosted server costs this share less, after the yearly discount. */
export const LICENSE_BUNDLE_DISCOUNT_PERCENT = 10;

/** The base price and the price of each extra user, in minor units. */
export interface LicensePrice {
  base: number;
  extraUser: number;
}

/** The monthly price of the Starter license, for its one user, in minor units. */
export const LICENSE_STARTER_MONTHLY: Readonly<Record<BillingCurrency, number>> = {
  eur: 1_000,
  usd: 1_200,
  pln: 4_000,
};

/** The monthly price of the Team license: the base for the included users, then each extra user. */
export const LICENSE_PRICES: Readonly<Record<BillingCurrency, LicensePrice>> = {
  eur: { base: 2_500, extraUser: 1_500 },
  usd: { base: 3_000, extraUser: 1_800 },
  pln: { base: 10_000, extraUser: 6_000 },
};

function percentOff(amount: number, percent: number): number {
  return Math.round((amount * (100 - percent)) / 100);
}

/** The price for one month of a license from its monthly list price, before the bundle discount. */
export function licenseMonthlyPrice(month: number, interval: BillingInterval): number {
  return interval === "month" ? month : percentOff(month, LICENSE_YEAR_DISCOUNT_PERCENT);
}

type LicensePlanKey = `${LicenseTier}_${"" | "bundle_"}${BillingInterval}`;

function licensePlanKey(plan: LicensePlan): LicensePlanKey {
  return `${plan.tier}_${plan.bundle ? "bundle_" : ""}${plan.interval}`;
}

/**
 * The Stripe amount of each plan for its whole period. Each amount is written out, so a rounding decision
 * changes data only. It equals `licenseOrderMonthly` (times 12 for a year); the Stripe E2E checks this.
 */
export const LICENSE_PLAN_PRICES: Readonly<Record<LicensePlanKey, Readonly<Record<BillingCurrency, LicensePrice>>>> = {
  starter_month: {
    eur: { base: 1_000, extraUser: 0 },
    usd: { base: 1_200, extraUser: 0 },
    pln: { base: 4_000, extraUser: 0 },
  },
  starter_year: {
    eur: { base: 9_600, extraUser: 0 },
    usd: { base: 11_520, extraUser: 0 },
    pln: { base: 38_400, extraUser: 0 },
  },
  starter_bundle_month: {
    eur: { base: 900, extraUser: 0 },
    usd: { base: 1_080, extraUser: 0 },
    pln: { base: 3_600, extraUser: 0 },
  },
  starter_bundle_year: {
    eur: { base: 8_640, extraUser: 0 },
    usd: { base: 10_368, extraUser: 0 },
    pln: { base: 34_560, extraUser: 0 },
  },
  team_month: LICENSE_PRICES,
  team_year: {
    eur: { base: 24_000, extraUser: 14_400 },
    usd: { base: 28_800, extraUser: 17_280 },
    pln: { base: 96_000, extraUser: 57_600 },
  },
  team_bundle_month: {
    eur: { base: 2_250, extraUser: 1_350 },
    usd: { base: 2_700, extraUser: 1_620 },
    pln: { base: 9_000, extraUser: 5_400 },
  },
  team_bundle_year: {
    eur: { base: 21_600, extraUser: 12_960 },
    usd: { base: 25_920, extraUser: 15_552 },
    pln: { base: 86_400, extraUser: 51_840 },
  },
};

/** The users that the base price of a tier includes. */
export function licenseIncludedUsers(tier: LicenseTier) {
  return tier === "team" ? LICENSE_INCLUDED_USERS : 1;
}

/** The most users that the app sells in a tier. */
export function licenseMaxUsers(tier: LicenseTier) {
  return tier === "team" ? LICENSE_MAX_USERS : 1;
}

/** The price of one period of a plan. */
export function licensePlanPrice(plan: LicensePlan, currency: BillingCurrency): LicensePrice {
  return LICENSE_PLAN_PRICES[licensePlanKey(plan)][currency];
}

/** The amount of one period of a plan with this many users, in minor units. */
export function licensePeriodAmount(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const price = licensePlanPrice(plan, currency);
  return price.base + Math.max(0, users - licenseIncludedUsers(plan.tier)) * price.extraUser;
}

/** The amount of a plan for one month, in minor units. A yearly plan gives a twelfth of its year. */
export function licenseMonthlyAmount(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const amount = licensePeriodAmount(plan, users, currency);
  return plan.interval === "year" ? Math.round(amount / 12) : amount;
}

/** The monthly list price of a tier with this many users, before the yearly and bundle discounts. */
export function licenseListMonthly(tier: LicenseTier, users: number, currency: BillingCurrency): number {
  return tier === "starter" ? LICENSE_STARTER_MONTHLY[currency] : licenseAmount(users, currency);
}

/**
 * The price for one month of a plan, as the order form shows it: the list price, less the yearly discount,
 * less the bundle discount. `LICENSE_PLAN_PRICES` holds the same amounts for Stripe.
 */
export function licenseOrderMonthly(plan: LicensePlan, users: number, currency: BillingCurrency): number {
  const month = licenseMonthlyPrice(licenseListMonthly(plan.tier, users, currency), plan.interval);
  return plan.bundle ? percentOff(month, LICENSE_BUNDLE_DISCOUNT_PERCENT) : month;
}

/** The monthly amount of a Team license with this many users, in minor units. */
export function licenseAmount(users: number, currency: BillingCurrency): number {
  const price = LICENSE_PRICES[currency];
  return price.base + Math.max(0, users - LICENSE_INCLUDED_USERS) * price.extraUser;
}

/** True for a user count that the app can buy or set in the Team tier. */
export function isLicenseUserCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= LICENSE_INCLUDED_USERS && value <= LICENSE_MAX_USERS;
}

/** True for a user count that the app sells in this tier. */
export function isLicenseTierUserCount(tier: LicenseTier, value: unknown): value is number {
  return tier === "team" ? isLicenseUserCount(value) : value === 1;
}

/**
 * The plan of a license Price. The Price metadata names it; a Price from before the tiers has only the
 * Team monthly lookup key. An unknown Price is read as Team monthly.
 */
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

/** The plan of a license. A license from an account server before the tiers is Team monthly. */
export function licensePlanOf(license: {
  tier?: LicenseTier;
  interval?: BillingInterval;
  bundle?: boolean;
}): LicensePlan {
  return { tier: license.tier ?? "team", interval: license.interval ?? "month", bundle: license.bundle ?? false };
}

/** What a server order buys with the server: one license, at the bundle price. */
export interface LicenseOrder {
  tier: LicenseTier;
  users: number;
}

/** The license for this many people at work: 1 is Starter; more is Team, which bills at least its included users. */
export function licenseOrderFor(people: number): LicenseOrder {
  return people === 1
    ? { tier: "starter", users: 1 }
    : { tier: "team", users: Math.max(LICENSE_INCLUDED_USERS, people) };
}

/** The next user count to offer: 1 is Starter, and the Team counts follow it. */
export function stepLicenseUsers(users: number, delta: 1 | -1): number {
  return Math.max(1, users + delta);
}

export interface License {
  /** The Stripe subscription id. */
  subscriptionId: string;
  /** The number of users that the license pays for. */
  users: number;
  currency: BillingCurrency;
  /**
   * The monthly list price in minor units, before discounts and tax. A yearly license gives a twelfth of
   * its year, so an app from before yearly licenses shows a correct monthly price.
   */
  amount: number;
  /** Absent from an account server before the tiers: Team. */
  tier?: LicenseTier;
  /** Absent from an account server before the tiers: monthly. */
  interval?: BillingInterval;
  /** True for the bundle price of an account with a hosted server. Absent before the tiers: false. */
  bundle?: boolean;
  status: BillingSubscriptionStatus;
  /** Milliseconds since the epoch. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

/** One person that the license of the account counts. */
export interface LicenseUser {
  name: string | null;
  email: string;
  /** The names of the owner's servers where this person is an active member. */
  servers: string[];
  /** True for the owner of the license. */
  owner: boolean;
}

/** The license of a server owner that covers this account. */
export interface LicenseCoverage {
  ownerName: string | null;
  ownerEmail: string;
}

export interface LicenseState {
  /** False when the account server has no billing. The app then shows no license. */
  available: boolean;
  /**
   * The currency of the account's open subscriptions. A Stripe customer pays in one currency, so a new
   * license must use it. Null when the account has no open subscription.
   */
  currency: BillingCurrency | null;
  /** The open license of the account, else its newest ended license, else null. */
  license: License | null;
  /** The number of people that the license counts now. */
  used: number;
  users: LicenseUser[];
  /** The open licenses of the owners of servers where this account is a member. */
  coveredBy: LicenseCoverage[];
  /** True when the account pays for a hosted server, so a new license gets the bundle price. */
  bundle?: boolean;
  /**
   * A new license is free until this time, in milliseconds since the epoch: Stripe charges its first
   * payment then. Absent when a new license is paid at once.
   */
  trialEnd?: number;
}

export interface LicenseCheckoutRequest {
  users: number;
  currency: BillingCurrency;
  /** Absent from an app before the tiers: Team. */
  tier?: LicenseTier;
  /** Absent from an app before the tiers: monthly. */
  interval?: BillingInterval;
}

/** A change of an open license to the Team tier, or of a monthly Team license to yearly. */
export interface LicensePlanRequest {
  interval: BillingInterval;
  users: number;
}

export interface LicenseUsersRequest {
  users: number;
}

export interface LicenseRenewalRequest {
  /** True cancels the license at the end of its period. False renews it again. */
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
    // A value from a later account server that this app does not know is left out.
    ...(isOneOf(LICENSE_TIERS, value.tier) ? { tier: value.tier } : {}),
    ...(isOneOf(BILLING_INTERVALS, value.interval) ? { interval: value.interval } : {}),
    ...(isBoolean(value.bundle) ? { bundle: value.bundle } : {}),
  };
}

/**
 * The date of a license trial end, as the app writes it. It is in UTC, so that the page that the Worker
 * renders and each browser write the same day.
 */
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

/** Returns null for a value that is not a license state in the account server shape. */
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

/** A request with no tier or interval is the Team monthly license that apps before the tiers buy. */
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

/** Returns null for a value that is not a license order of a server create request. */
export function parseLicenseOrder(value: unknown): LicenseOrder | null {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(LICENSE_TIERS, value.tier) ||
    !isLicenseTierUserCount(value.tier, value.users)
  )
    return null;
  return { tier: value.tier, users: value.users };
}

/** An order from the pricing page: a server plan, a license, or both, at one interval and currency. */
export interface PricingOrder {
  server: BillingPlanId | null;
  license: LicenseOrder | null;
  interval: BillingInterval;
  currency: BillingCurrency;
}

/** The query parameters that carry a pricing page order to `/app`. */
export const PRICING_ORDER_PARAMS = ["plan", "license", "users", "interval", "currency"] as const;

/**
 * The query of a pricing page order, so that the app goes to Checkout without a second choice. `users` stays a
 * number: the router writes a string that looks like a number in quotes.
 */
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

/** Returns null when the query has no complete pricing page order. */
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

/** Returns the Checkout page URL from a `{ url }` response, or null when it is not a Stripe Checkout page. */
export function parseLicenseCheckoutUrl(value: unknown): string | null {
  return isDynamicRecord(value) && isStripeCheckoutUrl(value.url) ? value.url : null;
}
