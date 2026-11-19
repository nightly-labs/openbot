import { DEFAULT_TEAM_MEMBER_LIMIT } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type BillingPlanId = "starter" | "standard" | "pro";
export type BillingInterval = "month" | "year";
export type BillingCurrency = "eur" | "usd" | "pln" | "brl";
export type BillingBaseCurrency = "eur" | "usd" | "pln";
export type BillingOptionalCurrency = Exclude<BillingCurrency, BillingBaseCurrency>;
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
  memberLimit: number;
  siteLimit: number;
  relativeSpeed: number;
}

export const BILLING_PLANS: readonly BillingPlan[] = [
  { id: "starter", storageGb: 25, memberLimit: 1, siteLimit: 3, relativeSpeed: 1 },
  { id: "standard", storageGb: 50, memberLimit: 5, siteLimit: 10, relativeSpeed: 2 },
  { id: "pro", storageGb: 100, memberLimit: 10, siteLimit: 50, relativeSpeed: 4 },
];

const OPERATOR_HOST_STORAGE_GB: Readonly<Record<BillingPlanId, number>> = {
  starter: 25,
  standard: 75,
  pro: 150,
};

export function planStorageGb(plan: BillingPlanId, onOperatorHost: boolean): number {
  if (onOperatorHost) return OPERATOR_HOST_STORAGE_GB[plan];
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.storageGb ?? 0;
}

export type BillingStorageTier = 0 | 1 | 2;
export type BillingStorageUpgradeTier = Exclude<BillingStorageTier, 0>;
export const BILLING_STORAGE_UPGRADE_TIERS: readonly BillingStorageUpgradeTier[] = [1, 2];

const STORAGE_TIER_GB: Readonly<Record<BillingPlanId, readonly [number, number]>> = {
  starter: [50, 100],
  standard: [125, 200],
  pro: [200, 300],
};

export function storageTierOf(value: unknown): BillingStorageTier {
  return value === 1 || value === 2 ? value : 0;
}

export function storageTierGb(plan: BillingPlanId, tier: BillingStorageTier): number {
  if (tier === 0) return OPERATOR_HOST_STORAGE_GB[plan];
  return STORAGE_TIER_GB[plan][tier === 1 ? 0 : 1];
}

export function hostedPlanStorageGb(plan: BillingPlanId, onOperatorHost: boolean, tier: BillingStorageTier): number {
  return onOperatorHost ? storageTierGb(plan, tier) : planStorageGb(plan, false);
}

export function isStorageGb(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1;
}

interface ServerStorage {
  plan: BillingPlanId;
  storageGb?: number | undefined;
}

export function serverStorageGb(server: ServerStorage): number {
  return server.storageGb ?? planStorageGb(server.plan, false);
}

export const LEGACY_MEMBER_LIMITS: Readonly<Record<BillingPlanId, number>> = {
  starter: DEFAULT_TEAM_MEMBER_LIMIT,
  standard: 10,
  pro: 25,
};

const BILLING_PLAN_MONTHLY_PRICES: Readonly<Record<BillingPlanId, Readonly<Record<BillingCurrency, number>>>> = {
  starter: { eur: 3000, usd: 3600, pln: 12000, brl: 18000 },
  standard: { eur: 5000, usd: 6000, pln: 20000, brl: 30000 },
  pro: { eur: 10000, usd: 12000, pln: 40000, brl: 60000 },
};

export function billingListPrices(plan: BillingPlanId, interval: BillingInterval): Record<BillingCurrency, number> {
  const monthly = BILLING_PLAN_MONTHLY_PRICES[plan];
  if (interval === "month") return { ...monthly };
  const year = (amount: number) => (amount * 12 * 4) / 5;
  return { eur: year(monthly.eur), usd: year(monthly.usd), pln: year(monthly.pln), brl: year(monthly.brl) };
}

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

export function memberLimitForPlan(plan: BillingPlanId | null): number {
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
}

export function siteLimitForPlan(plan: BillingPlanId | null): number {
  return BILLING_PLANS.find((candidate) => candidate.id === plan)?.siteLimit ?? 1;
}

export const BILLING_METADATA = { userId: "openbot_user_id", serverId: "openbot_server_id" } as const;

export function billingLookupKey(plan: BillingPlanId, interval: BillingInterval): string {
  return `openbot_${plan}_${interval}`;
}

export function storageTierLookupKey(
  plan: BillingPlanId,
  tier: BillingStorageUpgradeTier,
  interval: BillingInterval,
): string {
  return `openbot_storage_${plan}_${tier}_${interval}`;
}

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

export function parseStorageTierPrice(price: {
  lookup_key: string | null;
  metadata: Readonly<Record<string, string>>;
}): { plan: BillingPlanId; tier: BillingStorageUpgradeTier; interval: BillingInterval } | null {
  const fromKey = parseStorageTierLookupKey(price.lookup_key);
  if (fromKey || price.metadata.openbot_kind !== "storage") return fromKey;
  const { openbot_plan: plan, openbot_storage_tier: tier, openbot_interval: interval } = price.metadata;
  return parseStorageTierLookupKey(`openbot_storage_${plan}_${tier}_${interval}`);
}

export function parseBillingLookupKey(value: unknown): { plan: BillingPlanId; interval: BillingInterval } | null {
  if (!isString(value)) return null;
  const match = /^openbot_([a-z]+)_([a-z]+)$/u.exec(value);
  if (!match) return null;
  const [, plan, interval] = match;
  if (!isOneOf(BILLING_PLAN_IDS, plan) || !isOneOf(BILLING_INTERVALS, interval)) return null;
  return { plan, interval };
}

export interface BillingServerPlan {
  subscriptionId: string;
  serverId: string | null;
  serverName: string | null;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  amount: number | null;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  storageGb?: number;
  storageUpgrades?: BillingStorageUpgrade[];
}

export interface BillingStorageUpgrade {
  tier: BillingStorageUpgradeTier;
  storageGb: number;
  amount: number | null;
}

export interface BillingState {
  available: boolean;
  hasCustomer: boolean;
  servers: BillingServerPlan[];
}

export type BillingPortalRequest = { flow: "manage" } | { flow: "update" | "cancel"; subscriptionId: string };

export function isOpenBillingStatus(status: BillingSubscriptionStatus): boolean {
  return (
    status === "active" || status === "trialing" || status === "past_due" || status === "unpaid" || status === "paused"
  );
}

export function isBillingAmount(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,250}$/u;

export interface BillingStorageRequest {
  subscriptionId: string;
  tier: BillingStorageUpgradeTier;
}

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
    ...(isStorageGb(value.storageGb) ? { storageGb: value.storageGb } : {}),
    ...(Array.isArray(value.storageUpgrades) ? { storageUpgrades: parseStorageUpgrades(value.storageUpgrades) } : {}),
  };
}

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

export function isStripeHostedUrl(value: unknown): value is string {
  return isHttpsPageOn(value, "billing.stripe.com");
}

export function isStripeCheckoutUrl(value: unknown): value is string {
  return isHttpsPageOn(value, "checkout.stripe.com");
}

export function parseBillingSessionUrl(value: unknown): string | null {
  return isDynamicRecord(value) && isStripeHostedUrl(value.url) ? value.url : null;
}
