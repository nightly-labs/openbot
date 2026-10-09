import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
  isStripeCheckoutUrl,
} from "./billing";
import { INPUT_LIMITS } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";
import { slugifyTeamServerName } from "./validation";

/** The provider machine sizes, from the boat machine table (docs.boat.dev/machines). */
export const HOSTED_SERVER_SIZES = {
  small: { vcpu: 2, memoryGb: 4, diskGb: 12 },
  default: { vcpu: 4, memoryGb: 8, diskGb: 50 },
  large: { vcpu: 8, memoryGb: 16, diskGb: 125 },
} as const;

export type HostedServerSize = keyof typeof HOSTED_SERVER_SIZES;

export const HOSTED_SERVER_SIZE_NAMES = ["small", "default", "large"] as const satisfies readonly HostedServerSize[];

/** The machine of each plan. The plan decides the size: a user never selects a size. */
export const HOSTED_PLAN_SIZE: Readonly<Record<BillingPlanId, HostedServerSize>> = {
  starter: "small",
  standard: "default",
  pro: "large",
};

export const HOSTED_SERVER_STATES = [
  /** The row exists, and the account server waits for Stripe to confirm the first payment. */
  "awaiting_payment",
  "creating",
  "starting",
  "running",
  "stopping",
  "stopped",
  "waking",
  "error",
  "deleted",
] as const;

export type HostedServerState = (typeof HOSTED_SERVER_STATES)[number];

/**
 * The reason codes for a server in the error state, or for a server that stopped. They never contain
 * provider text. `plan_ended`: the plan was cancelled or not paid, so the server stopped. Its data stays.
 */
export const HOSTED_SERVER_ERRORS = [
  "provider_error",
  "provider_billing",
  "provider_limit",
  "start_failed",
  "plan_ended",
] as const;

export type HostedServerError = (typeof HOSTED_SERVER_ERRORS)[number];

/**
 * Returns the trimmed name, or null for a name that the team store of the server refuses. The server
 * cannot publish its host with such a name.
 */
export function parseHostedServerName(value: string): string | null {
  const name = value.trim();
  if (name.length < INPUT_LIMITS.serverNameMin || name.length > INPUT_LIMITS.serverName || /\p{Cc}/u.test(name)) {
    return null;
  }
  return slugifyTeamServerName(name).length >= INPUT_LIMITS.serverNameMin ? name : null;
}

/** "Contact us" in the add server dialog, for a plan that the dialog does not have. */
export const HOSTED_SERVER_CONTACT_URL = "mailto:hello@openbot.run";
/**
 * A development build sends the shared developer key in this header. A Worker with the same
 * `HOSTED_SERVERS_DEVELOPER_KEY` lets the account create servers, as the allow list does.
 */
export const HOSTING_DEVELOPER_KEY_HEADER = "OpenBot-Hosting-Developer-Key";

export interface HostedServerSummary {
  deletionScheduledAt?: number | null;
  /** The same value as the Remote host id of the server. */
  serverId: string;
  name: string;
  size: HostedServerSize;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  state: HostedServerState;
  error: HostedServerError | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The state of one hosted server, for its owner and its members. `sleeping`: the Worker stopped the
 * server because nobody used it. A client then waits for the user's next input before it wakes it.
 */
export interface HostedServerStatus {
  serverId: string;
  state: HostedServerState;
  error: HostedServerError | null;
  sleeping: boolean;
}

export interface HostedServerList {
  lifecycleAvailable?: boolean;
  /** False when this account cannot create hosted servers, or when the account server has no billing. */
  available: boolean;
  servers: HostedServerSummary[];
  /**
   * The most servers that the account can have. Each server in `servers` counts, also one that waits
   * for its first payment. Null from an account server that does not send it.
   */
  maxServers: number | null;
}

export interface HostedServerClaim {
  hostId: string;
  name: string;
  sessionToken: string;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
}

export function isHostedServerSize(value: unknown): value is HostedServerSize {
  return isOneOf(HOSTED_SERVER_SIZE_NAMES, value);
}

export function isHostedServerState(value: unknown): value is HostedServerState {
  return isOneOf(HOSTED_SERVER_STATES, value);
}

/** Returns null for a value that is not a hosted server summary. */
export function parseHostedServerSummary(value: unknown): HostedServerSummary | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !isString(value.name) ||
    !isHostedServerSize(value.size) ||
    !isOneOf(BILLING_PLAN_IDS, value.plan) ||
    !isOneOf(BILLING_INTERVALS, value.interval) ||
    !isOneOf(BILLING_CURRENCIES, value.currency) ||
    !isString(value.state) ||
    !(value.error === null || isString(value.error)) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt)
  ) {
    return null;
  }
  // A state or an error that a newer Worker added shows as an error, so an older app still lists the server.
  const state: HostedServerState = isHostedServerState(value.state) ? value.state : "error";
  const error: HostedServerError | null =
    state !== value.state ? "provider_error" : isOneOf(HOSTED_SERVER_ERRORS, value.error) ? value.error : null;
  return {
    deletionScheduledAt:
      typeof value.deletionScheduledAt === "number" &&
      Number.isSafeInteger(value.deletionScheduledAt) &&
      value.deletionScheduledAt > 0
        ? value.deletionScheduledAt
        : null,
    serverId: value.serverId,
    name: value.name,
    size: value.size,
    plan: value.plan,
    interval: value.interval,
    currency: value.currency,
    state,
    error,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/** Returns null for a value that is not a hosted server status. */
export function parseHostedServerStatus(value: unknown): HostedServerStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !isString(value.state) ||
    !(value.error === null || isString(value.error)) ||
    !isBoolean(value.sleeping)
  ) {
    return null;
  }
  // As in the summary: a state that a newer Worker added shows as an error.
  const state: HostedServerState = isHostedServerState(value.state) ? value.state : "error";
  const error: HostedServerError | null =
    state !== value.state ? "provider_error" : isOneOf(HOSTED_SERVER_ERRORS, value.error) ? value.error : null;
  return { serverId: value.serverId, state, error, sleeping: value.sleeping };
}

/**
 * Returns null for a value that is not a hosted server list. A server that this app cannot read, for
 * example with a plan that a newer Worker added, is left out, so the others still show.
 */
export function parseHostedServerList(value: unknown): HostedServerList | null {
  if (!isDynamicRecord(value) || !isBoolean(value.available) || !Array.isArray(value.servers)) return null;
  const servers: HostedServerSummary[] = [];
  for (const entry of value.servers) {
    const server = parseHostedServerSummary(entry);
    if (server) servers.push(server);
  }
  const maxServers =
    isNumber(value.maxServers) && Number.isSafeInteger(value.maxServers) && value.maxServers >= 0
      ? value.maxServers
      : null;
  return { available: value.available, lifecycleAvailable: value.lifecycleAvailable === true, servers, maxServers };
}

/** Returns null for a value that is not a redeemed claim. */
export function parseHostedServerClaim(value: unknown): HostedServerClaim | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.hostId) ||
    !isString(value.name) ||
    !isString(value.sessionToken) ||
    !isDynamicRecord(value.user)
  ) {
    return null;
  }
  const user = value.user;
  if (
    !isString(user.id) ||
    !isString(user.email) ||
    !(user.name === null || isString(user.name)) ||
    !(user.avatarUrl === null || isString(user.avatarUrl))
  ) {
    return null;
  }
  return {
    hostId: value.hostId,
    name: value.name,
    sessionToken: value.sessionToken,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  };
}

export interface CreateHostedServerInput {
  name: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  /** One ID for each opened create form, so a repeated submit does not create a second server. */
  requestId: string;
}

/**
 * The account server's answer to a create or a new payment page. `checkoutUrl` is the Stripe Checkout
 * page, or null when the server needs no payment page (its plan started already).
 */
export interface HostedServerCheckout {
  server: HostedServerSummary;
  checkoutUrl: string | null;
}

/** One plan as the create dialog shows it. Amounts are in the minor unit of the currency. */
export interface HostedServerCatalogPlan {
  id: BillingPlanId;
  diskGb: number;
  memberLimit: number;
  relativeSpeed: number;
  prices: Record<BillingCurrency, Record<BillingInterval, number>>;
}

export interface HostedServerCatalog {
  plans: HostedServerCatalogPlan[];
}

export interface DeleteHostedServerInput {
  serverId: string;
  /** The server name as the user typed it. The account server compares it to the stored name. */
  confirmName: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

/** Returns null for a value that is not a valid create request. */
export function parseCreateHostedServerInput(value: unknown): CreateHostedServerInput | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    !isOneOf(BILLING_PLAN_IDS, value.plan) ||
    !isOneOf(BILLING_INTERVALS, value.interval) ||
    !isOneOf(BILLING_CURRENCIES, value.currency)
  ) {
    return null;
  }
  const name = parseHostedServerName(value.name);
  if (!name) return null;
  if (!isString(value.requestId) || !REQUEST_ID_PATTERN.test(value.requestId)) return null;
  return { name, plan: value.plan, interval: value.interval, currency: value.currency, requestId: value.requestId };
}

/** Returns null for a value that is not a checkout answer, or whose URL is not a Stripe Checkout page. */
export function parseHostedServerCheckout(value: unknown): HostedServerCheckout | null {
  if (!isDynamicRecord(value)) return null;
  const server = parseHostedServerSummary(value.server);
  if (!server || !(value.checkoutUrl === null || isStripeCheckoutUrl(value.checkoutUrl))) return null;
  return { server, checkoutUrl: value.checkoutUrl };
}

function parsePlanPrices(value: unknown): HostedServerCatalogPlan["prices"] | null {
  if (!isDynamicRecord(value)) return null;
  const prices: Partial<HostedServerCatalogPlan["prices"]> = {};
  for (const currency of BILLING_CURRENCIES) {
    const entry = value[currency];
    if (!isDynamicRecord(entry) || !isBillingAmount(entry.month) || !isBillingAmount(entry.year)) return null;
    prices[currency] = { month: entry.month, year: entry.year };
  }
  const { eur, usd, pln } = prices;
  return eur && usd && pln ? { eur, usd, pln } : null;
}

/** Returns null for a value that is not a plan catalog. A plan that this app cannot read is left out. */
export function parseHostedServerCatalog(value: unknown): HostedServerCatalog | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.plans)) return null;
  const plans: HostedServerCatalogPlan[] = [];
  for (const entry of value.plans) {
    if (
      !isDynamicRecord(entry) ||
      !isOneOf(BILLING_PLAN_IDS, entry.id) ||
      !isNumber(entry.diskGb) ||
      !isNumber(entry.memberLimit) ||
      !isNumber(entry.relativeSpeed)
    ) {
      continue;
    }
    const prices = parsePlanPrices(entry.prices);
    if (!prices) continue;
    plans.push({
      id: entry.id,
      diskGb: entry.diskGb,
      memberLimit: entry.memberLimit,
      relativeSpeed: entry.relativeSpeed,
      prices,
    });
  }
  return { plans };
}

/** Returns null for a value that is not a valid delete request. */
export function parseDeleteHostedServerInput(value: unknown): DeleteHostedServerInput | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !isString(value.confirmName)) return null;
  if (!value.serverId || value.serverId.length > INPUT_LIMITS.identifier) return null;
  if (value.confirmName.length > INPUT_LIMITS.serverName) return null;
  return { serverId: value.serverId, confirmName: value.confirmName };
}

/** A hosted server sends this to the account server, so that the account server stops and starts it at the right time. */
export interface HostedServerActivityReport {
  /** A client works with the server, or an agent works. */
  inUse: boolean;
  /** The next routine run, in milliseconds since the epoch, or null for none. Undefined keeps the stored run. */
  nextRunAt?: number | null;
}

/** An empty body is from an older server, which reports only when it is in use. */
export function parseHostedServerActivityReport(value: unknown): HostedServerActivityReport | null {
  if (value === null) return { inUse: true };
  if (!isDynamicRecord(value) || !isBoolean(value.inUse)) return null;
  if (value.nextRunAt === undefined) return { inUse: value.inUse };
  if (value.nextRunAt !== null && !(isNumber(value.nextRunAt) && Number.isSafeInteger(value.nextRunAt))) return null;
  return { inUse: value.inUse, nextRunAt: value.nextRunAt };
}

export interface HostedServerLifecycleInput {
  serverId: string;
  action: "cancel" | "keep" | "delete";
  timing?: "period-end" | "now";
  confirmName?: string;
  expectedPeriodEnd?: number;
}

/** Reject malformed mutations before they cross the account boundary. */
export function parseHostedServerLifecycleInput(value: unknown): HostedServerLifecycleInput | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !value.serverId ||
    value.serverId.length > INPUT_LIMITS.identifier ||
    !isOneOf(["cancel", "keep", "delete"] as const, value.action)
  )
    return null;
  if (
    value.expectedPeriodEnd !== undefined &&
    (!isNumber(value.expectedPeriodEnd) ||
      !Number.isSafeInteger(value.expectedPeriodEnd) ||
      value.expectedPeriodEnd <= 0)
  )
    return null;
  if (value.action === "delete") {
    if (
      !isOneOf(["period-end", "now"] as const, value.timing) ||
      !isString(value.confirmName) ||
      value.confirmName.length > INPUT_LIMITS.serverName
    )
      return null;
    return {
      serverId: value.serverId,
      action: value.action,
      timing: value.timing,
      confirmName: value.confirmName,
      ...(value.expectedPeriodEnd === undefined ? {} : { expectedPeriodEnd: value.expectedPeriodEnd }),
    };
  }
  return { serverId: value.serverId, action: value.action };
}
