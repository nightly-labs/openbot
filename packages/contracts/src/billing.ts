import { DEFAULT_TEAM_MEMBER_LIMIT } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type BillingPlanId = "starter" | "standard" | "pro";
export type BillingInterval = "month" | "year";
export type BillingCurrency = "eur" | "usd" | "pln";
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
export const BILLING_CURRENCIES: readonly BillingCurrency[] = ["eur", "usd", "pln"];
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
  /** The number of active hosted sites of a server with this plan. The account server enforces it. */
  siteLimit: number;
  /** The speed of the plan's machine, where Starter is 1. */
  relativeSpeed: number;
}

/** The storage, members and speed of each plan. The amounts are Stripe Prices, not code. */
export const BILLING_PLANS: readonly BillingPlan[] = [
  { id: "starter", storageGb: 12, memberLimit: DEFAULT_TEAM_MEMBER_LIMIT, siteLimit: 3, relativeSpeed: 1 },
  { id: "standard", storageGb: 50, memberLimit: 10, siteLimit: 10, relativeSpeed: 2 },
  { id: "pro", storageGb: 100, memberLimit: 25, siteLimit: 50, relativeSpeed: 4 },
];

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
   * The list price of one period in the minor unit of `currency` (cents), before discounts and tax.
   * Null when Stripe gave no fixed amount.
   */
  amount: number | null;
  status: BillingSubscriptionStatus;
  /** Milliseconds since the epoch. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
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
 * - `update`: change the plan of one server.
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
