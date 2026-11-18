import { DEFAULT_TEAM_MEMBER_LIMIT } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type BillingPlanId = "starter" | "standard" | "pro";
export type BillingInterval = "month" | "year";
export type BillingCurrency = "eur" | "usd" | "pln" | "brl";
/** The currencies of every plan. An account server before BRL sends prices in these only. */
export type BillingBaseCurrency = "eur" | "usd" | "pln";
/** A currency that a plan has only when its Stripe Price has it as a currency option. */
export type BillingOptionalCurrency = Exclude<BillingCurrency, BillingBaseCurrency>;
/** The Stripe subscription statuses. The account server stores the status that Stripe reports. */
export type BillingSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export const BILLING_PLAN_IDS: readonly BillingPlanId[] = ["starter", "standard", "pro"];
export const BILLING_INTERVALS: readonly BillingInterval[] = ["month", "year"];
export const BILLING_CURRENCIES: readonly BillingCurrency[] = ["eur", "usd", "pln", "brl"];
export const BILLING_BASE_CURRENCIES: readonly BillingBaseCurrency[] = ["eur", "usd", "pln"];
export const BILLING_OPTIONAL_CURRENCIES: readonly BillingOptionalCurrency[] = ["brl"];
export const BILLING_SUBSCRIPTION_STATUSES: readonly BillingSubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
];

export interface BillingPlan {
  id: BillingPlanId;
  storageGb: number;
  /** The number of active members of a server with this plan. The account server enforces it. */
  memberLimit: number;
  /**
   * The number of active hosted sites of a server with this plan. The account server enforces it. A
   * custom limit of one server (`server_site_limits`) replaces it.
   */
  siteLimit: number;
  /** The speed of the plan's machine, where Starter is 1. */
  relativeSpeed: number;
}

/** The storage, members and speed of each plan. A buyer pays the Stripe Prices; see `billingListPrices`. */
export const BILLING_PLANS: readonly BillingPlan[] = [
  { id: "starter", storageGb: 25, memberLimit: 1, siteLimit: 3, relativeSpeed: 1 },
  { id: "standard", storageGb: 50, memberLimit: 5, siteLimit: 10, relativeSpeed: 2 },
  { id: "pro", storageGb: 100, memberLimit: 10, siteLimit: 50, relativeSpeed: 4 },
];

/**
 * The storage of each plan in GB for a hosted server on a machine of the operator (a VPS). That
 * machine has a larger disk than a boat sandbox, and much of it stays free above these numbers. The
 * pricing page and the order form show `BILLING_PLANS`, because a new server can start in a boat sandbox.
 * Starter has the same storage on both.
 */
const OPERATOR_HOST_STORAGE_GB: Readonly<Record<BillingPlanId, number>> = {
  starter: 25,
  standard: 75,
  pro: 150,
};

/** The storage in GB that `plan` gives a hosted server. */
export function planStorageGb(plan: BillingPlanId, onOperatorHost: boolean): number {
  if (onOperatorHost) return OPERATOR_HOST_STORAGE_GB[plan];
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.storageGb ?? 0;
}

/**
 * A storage tier of a hosted server on a VPS of the operator: 0 is the plan storage, and 1 and 2 are
 * larger disks that the owner buys as a Stripe add-on. A tier never goes down, and a boat sandbox has none.
 */
export type BillingStorageTier = 0 | 1 | 2;
/** A tier that the owner can buy. */
export type BillingStorageUpgradeTier = Exclude<BillingStorageTier, 0>;
export const BILLING_STORAGE_UPGRADE_TIERS: readonly BillingStorageUpgradeTier[] = [1, 2];

/**
 * The storage in GB of tiers 1 and 2 of each plan. Tier 2 is the whole disk of the plan's VPS: VPS 1
 * 100 GB, VPS 2 200 GB, VPS 3 300 GB. The free space that clients show is never more than the disk has
 * (`hostedPlanDisk`), so the system part of the disk is shown as used.
 */
const STORAGE_TIER_GB: Readonly<Record<BillingPlanId, readonly [number, number]>> = {
  starter: [50, 100],
  standard: [125, 200],
  pro: [200, 300],
};

/** A stored storage tier. A value that is not a tier is 0, the plan storage. */
export function storageTierOf(value: unknown): BillingStorageTier {
  return value === 1 || value === 2 ? value : 0;
}

/** The storage in GB of `plan` at `tier` on a VPS of the operator. */
export function storageTierGb(plan: BillingPlanId, tier: BillingStorageTier): number {
  if (tier === 0) return OPERATOR_HOST_STORAGE_GB[plan];
  return STORAGE_TIER_GB[plan][tier === 1 ? 0 : 1];
}

/** The storage in GB of a hosted server. A storage tier counts only on a VPS of the operator. */
export function hostedPlanStorageGb(plan: BillingPlanId, onOperatorHost: boolean, tier: BillingStorageTier): number {
  return onOperatorHost ? storageTierGb(plan, tier) : planStorageGb(plan, false);
}

/** A storage value of the account server: a whole number of GB, 1 or more. */
export function isStorageGb(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1;
}

/** The plan and the storage of one server, as the account server sends them. */
interface ServerStorage {
  plan: BillingPlanId;
  storageGb?: number | undefined;
}

/**
 * The storage of a server in GB: the value from the account server, or the plan table for an account
 * server from before that value.
 */
export function serverStorageGb(server: ServerStorage): number {
  return server.storageGb ?? planStorageGb(server.plan, false);
}

/**
 * The active member limit of each plan for a server made before the limits of `BILLING_PLANS`. Such a
 * server keeps the limit that it had when the owner bought it.
 */
export const LEGACY_MEMBER_LIMITS: Readonly<Record<BillingPlanId, number>> = {
  starter: DEFAULT_TEAM_MEMBER_LIMIT,
  standard: 10,
  pro: 25,
};

/**
 * The monthly list price of each plan, in minor units (cents, grosze, centavos). Each amount divides by 5, so
 * a year (12 months less 20%) is a whole number. BRL is the EUR price times 6. Starter subscriptions from before
 * 2026-11-14 keep their Stripe Price of €20, $25, 80 zł or R$120. (The BRL Starter license is 30% lower;
 * see license.ts.)
 */
const BILLING_PLAN_MONTHLY_PRICES: Readonly<Record<BillingPlanId, Readonly<Record<BillingCurrency, number>>>> = {
  starter: { eur: 3000, usd: 3600, pln: 12000, brl: 18000 },
  standard: { eur: 5000, usd: 6000, pln: 20000, brl: 30000 },
  pro: { eur: 10000, usd: 12000, pln: 40000, brl: 60000 },
};

/**
 * The list price of a plan for one interval, in minor units. `scripts/stripe-bootstrap.ts` sets the
 * Stripe Prices to these amounts. The account server and the app read the Stripe Prices.
 */
export function billingListPrices(plan: BillingPlanId, interval: BillingInterval): Record<BillingCurrency, number> {
  const monthly = BILLING_PLAN_MONTHLY_PRICES[plan];
  if (interval === "month") return { ...monthly };
  const year = (amount: number) => (amount * 12 * 4) / 5;
  return { eur: year(monthly.eur), usd: year(monthly.usd), pln: year(monthly.pln), brl: year(monthly.brl) };
}

/**
 * The monthly price of the storage add-on of each tier, in minor units, on top of the plan price. Tier 1
 * is €0.40 for each GB above the plan; tier 2 costs less for each GB, so the larger disk is the better
 * buy. USD is EUR times 1.2, PLN times 4 and BRL times 6, as for the plans. Each amount divides by 5.
 */
const STORAGE_TIER_MONTHLY_PRICES: Readonly<
  Record<BillingPlanId, readonly [Readonly<Record<BillingCurrency, number>>, Readonly<Record<BillingCurrency, number>>]>
> = {
  starter: [
    { eur: 1000, usd: 1200, pln: 4000, brl: 6000 },
    { eur: 2000, usd: 2400, pln: 8000, brl: 12000 },
  ],
  standard: [
    { eur: 2000, usd: 2400, pln: 8000, brl: 12000 },
    { eur: 4000, usd: 4800, pln: 16000, brl: 24000 },
  ],
  pro: [
    { eur: 2000, usd: 2400, pln: 8000, brl: 12000 },
    { eur: 4500, usd: 5400, pln: 18000, brl: 27000 },
  ],
};

/**
 * The list price of the storage add-on of one tier for one interval, in minor units. A year is 12 months
 * less 20%, as for the plans. `scripts/stripe-bootstrap.ts` sets the Stripe Prices to these amounts.
 */
export function storageTierListPrices(
  plan: BillingPlanId,
  tier: BillingStorageUpgradeTier,
  interval: BillingInterval,
): Record<BillingCurrency, number> {
  const monthly = STORAGE_TIER_MONTHLY_PRICES[plan][tier === 1 ? 0 : 1];
  if (interval === "month") return { ...monthly };
  const year = (amount: number) => (amount * 12 * 4) / 5;
  return { eur: year(monthly.eur), usd: year(monthly.usd), pln: year(monthly.pln), brl: year(monthly.brl) };
}

/** The active member limit of a server with this plan, or with no plan. */
export function memberLimitForPlan(plan: BillingPlanId | null): number {
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
}

/** The active hosted-site limit of a server with this plan. A self-hosted server has no plan and gets 1. */
export function siteLimitForPlan(plan: BillingPlanId | null): number {
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.siteLimit ?? 1;
}

/**
 * The Stripe subscription metadata that links a subscription to an OpenBot account and server. The
 * Checkout that creates a server's subscription must set both keys.
 */
export const BILLING_METADATA = { userId: "openbot_user_id", serverId: "openbot_server_id" } as const;

/** The Stripe Price lookup key for one plan and interval. `stripe-bootstrap.ts` creates these keys. */
export function billingLookupKey(plan: BillingPlanId, interval: BillingInterval): string {
  return `openbot_${plan}_${interval}`;
}

/**
 * The Stripe Price lookup key of the storage add-on of one plan, tier and interval. It does not match
 * `parseBillingLookupKey`, so an add-on item is never read as the plan of a subscription.
 */
export function storageTierLookupKey(
  plan: BillingPlanId,
  tier: BillingStorageUpgradeTier,
  interval: BillingInterval,
): string {
  return `openbot_storage_${plan}_${tier}_${interval}`;
}

/** Returns null for a lookup key that does not name a storage add-on. */
export function parseStorageTierLookupKey(
  value: unknown,
): { plan: BillingPlanId; tier: BillingStorageUpgradeTier; interval: BillingInterval } | null {
  if (!isString(value)) return null;
  const match = /^openbot_storage_([a-z]+)_([12])_([a-z]+)$/u.exec(value);
  if (!match) return null;
  const [, plan, tier, interval] = match;
  if (!isOneOf(BILLING_PLAN_IDS, plan) || !isOneOf(BILLING_INTERVALS, interval)) return null;
  return { plan, tier: tier === "1" ? 1 : 2, interval };
}

/**
 * The metadata of a storage add-on Price. `stripe-bootstrap.ts` moves a lookup key to a new Price when an
 * amount changes, and a current subscription keeps the old Price, so the metadata still names the tier.
 */
export function storageTierPriceMetadata(
  plan: BillingPlanId,
  tier: BillingStorageUpgradeTier,
  interval: BillingInterval,
): Record<string, string> {
  return {
    openbot_kind: "storage",
    openbot_plan: plan,
    openbot_storage_tier: String(tier),
    openbot_interval: interval,
  };
}

/** The plan, tier and interval of a storage add-on Price, from its lookup key or its metadata. Null for another Price. */
export function parseStorageTierPrice(price: {
  lookup_key: string | null;
  metadata: Readonly<Record<string, string>>;
}): { plan: BillingPlanId; tier: BillingStorageUpgradeTier; interval: BillingInterval } | null {
  const fromKey = parseStorageTierLookupKey(price.lookup_key);
  if (fromKey || price.metadata.openbot_kind !== "storage") return fromKey;
  const { openbot_plan: plan, openbot_storage_tier: tier, openbot_interval: interval } = price.metadata;
  return parseStorageTierLookupKey(`openbot_storage_${plan}_${tier}_${interval}`);
}

/** Returns null for a lookup key that does not name a plan and interval. */
export function parseBillingLookupKey(value: unknown): { plan: BillingPlanId; interval: BillingInterval } | null {
  if (!isString(value)) return null;
  const match = /^openbot_([a-z]+)_([a-z]+)$/u.exec(value);
  if (!match) return null;
  const [, plan, interval] = match;
  if (!isOneOf(BILLING_PLAN_IDS, plan) || !isOneOf(BILLING_INTERVALS, interval)) return null;
  return { plan, interval };
}

/** One server's plan: a Stripe subscription that is still open. */
export interface BillingServerPlan {
  /** The Stripe subscription id. The account server checks that it belongs to the account. */
  subscriptionId: string;
  /** Null for a subscription that names no server. */
  serverId: string | null;
  /** Null when the account server has no record of the server. */
  serverName: string | null;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  /**
   * The list price of one period in the minor unit of `currency` (cents), before discounts and tax: the
   * plan and its storage add-on. Null when Stripe gave no fixed amount.
   */
  amount: number | null;
  status: BillingSubscriptionStatus;
  /** Milliseconds since the epoch. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** The storage of the server in GB. An account server from before this field sends none: see `serverStorageGb`. */
  storageGb?: number;
  /**
   * The storage tiers that the owner can buy now, smallest first. Empty or absent when there is none: a
   * boat sandbox, the largest tier, a plan that ends or does not renew, or an account server from before
   * storage tiers.
   */
  storageUpgrades?: BillingStorageUpgrade[];
}

/** A larger disk that the owner of a server can buy. */
export interface BillingStorageUpgrade {
  tier: BillingStorageUpgradeTier;
  storageGb: number;
  /**
   * The list price of one period after the change, in the minor unit of the plan's currency: the plan and
   * the add-on of this tier. Null when Stripe gave no fixed amount.
   */
  amount: number | null;
}

export interface BillingState {
  /** False when the account server has no Stripe configuration. */
  available: boolean;
  /** True when the account has a Stripe customer, so the Customer Portal can open. */
  hasCustomer: boolean;
  servers: BillingServerPlan[];
}

/**
 * The Customer Portal page to open:
 * - `manage`: the payment method, the invoices and all plans of the account.
 * - `update`: sent by clients from before storage tiers to change a plan. A plan does not change now, so
 *   the account server opens the `manage` page.
 * - `cancel`: cancel the plan of one server at the end of its period.
 */
export type BillingPortalRequest = { flow: "manage" } | { flow: "update" | "cancel"; subscriptionId: string };

/**
 * The statuses that keep the Stripe subscription open. A paused subscription is open too: the
 * Customer Portal resumes it.
 */
export function isOpenBillingStatus(status: BillingSubscriptionStatus): boolean {
  return (
    status === "active" || status === "trialing" || status === "past_due" || status === "unpaid" || status === "paused"
  );
}

/** A whole, non-negative number of minor units. */
export function isBillingAmount(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,250}$/u;

/** A request to buy a storage tier for the server of one subscription. */
export interface BillingStorageRequest {
  subscriptionId: string;
  tier: BillingStorageUpgradeTier;
}

/** Returns null for a value that is not a storage request. */
export function parseBillingStorageRequest(value: unknown): BillingStorageRequest | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.subscriptionId) ||
    !SUBSCRIPTION_ID_PATTERN.test(value.subscriptionId) ||
    !isOneOf(BILLING_STORAGE_UPGRADE_TIERS, value.tier)
  ) {
    return null;
  }
  return { subscriptionId: value.subscriptionId, tier: value.tier };
}

function parseStorageUpgrades(value: readonly unknown[]): BillingStorageUpgrade[] {
  const upgrades: BillingStorageUpgrade[] = [];
  for (const item of value) {
    if (
      isDynamicRecord(item) &&
      isOneOf(BILLING_STORAGE_UPGRADE_TIERS, item.tier) &&
      isStorageGb(item.storageGb) &&
      (item.amount === null || isBillingAmount(item.amount))
    ) {
      upgrades.push({ tier: item.tier, storageGb: item.storageGb, amount: item.amount });
    }
  }
  return upgrades;
}

function parseBillingServerPlan(value: unknown): BillingServerPlan | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.subscriptionId) ||
    !(value.serverId === null || isString(value.serverId)) ||
    !(value.serverName === null || isString(value.serverName)) ||
    !isOneOf(BILLING_PLAN_IDS, value.plan) ||
    !isOneOf(BILLING_INTERVALS, value.interval) ||
    !isOneOf(BILLING_CURRENCIES, value.currency) ||
    !(value.amount === null || isBillingAmount(value.amount)) ||
    !isOneOf(BILLING_SUBSCRIPTION_STATUSES, value.status) ||
    (value.currentPeriodEnd !== null && !isNumber(value.currentPeriodEnd)) ||
    !isBoolean(value.cancelAtPeriodEnd)
  ) {
    return null;
  }
  return {
    subscriptionId: value.subscriptionId,
    serverId: value.serverId,
    serverName: value.serverName,
    plan: value.plan,
    interval: value.interval,
    currency: value.currency,
    amount: value.amount,
    status: value.status,
    currentPeriodEnd: value.currentPeriodEnd,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    // A value that this app cannot read is left out, so the plan still shows with the storage of its table.
    ...(isStorageGb(value.storageGb) ? { storageGb: value.storageGb } : {}),
    // An older account server sends no upgrades; the plan then has none.
    ...(Array.isArray(value.storageUpgrades) ? { storageUpgrades: parseStorageUpgrades(value.storageUpgrades) } : {}),
  };
}

/**
 * Returns null for a value that is not a billing state in the account server shape. A plan that this
 * app cannot read, for example one that a newer Worker added, is left out.
 */
export function parseBillingState(value: unknown): BillingState | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !isBoolean(value.hasCustomer) ||
    !Array.isArray(value.servers)
  ) {
    return null;
  }
  const servers: BillingServerPlan[] = [];
  for (const item of value.servers) {
    const server = parseBillingServerPlan(item);
    if (server) servers.push(server);
  }
  return { available: value.available, hasCustomer: value.hasCustomer, servers };
}

/** Returns null for a value that is not a portal request. It keeps only the fields that the flow uses. */
export function parseBillingPortalRequest(value: unknown): BillingPortalRequest | null {
  if (!isDynamicRecord(value)) return null;
  if (value.flow === "manage") return { flow: "manage" };
  if (
    (value.flow === "update" || value.flow === "cancel") &&
    isString(value.subscriptionId) &&
    SUBSCRIPTION_ID_PATTERN.test(value.subscriptionId)
  ) {
    return { flow: value.flow, subscriptionId: value.subscriptionId };
  }
  return null;
}

function isHttpsPageOn(value: unknown, hostname: string): value is string {
  if (!isString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === hostname && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

/** True only for an https Customer Portal page. Clients open no other billing URL. */
export function isStripeHostedUrl(value: unknown): value is string {
  return isHttpsPageOn(value, "billing.stripe.com");
}

/** True only for an https Stripe Checkout page, where a new server's plan starts. */
export function isStripeCheckoutUrl(value: unknown): value is string {
  return isHttpsPageOn(value, "checkout.stripe.com");
}

/** Returns the Stripe page URL from a `{ url }` response, or null when it is not a Stripe page. */
export function parseBillingSessionUrl(value: unknown): string | null {
  return isDynamicRecord(value) && isStripeHostedUrl(value.url) ? value.url : null;
}
