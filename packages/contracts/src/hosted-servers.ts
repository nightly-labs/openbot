import {
  BILLING_BASE_CURRENCIES,
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_OPTIONAL_CURRENCIES,
  BILLING_PLAN_IDS,
  type BillingBaseCurrency,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
  isStorageGb,
  isStripeCheckoutUrl,
  planStorageGb,
} from "./billing";
import { INPUT_LIMITS } from "./input-limits";
import type { ConversationMessage } from "./ipc-conversation-messages";
import type { StorageDisk } from "./ipc-storage";
import { type LicenseOrder, parseLicenseOrder } from "./license";
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

/**
 * The boat sandbox of each plan. Starter runs on a VPS 1 of the operator. When no VPS 1 is free, it starts
 * on `default`, because `small` has less disk than the Starter storage. A move to a VPS 1 sets
 * `HOSTED_PLAN_SIZE` again.
 */
export const HOSTED_BOAT_PLAN_SIZE: Readonly<Record<BillingPlanId, HostedServerSize>> = {
  ...HOSTED_PLAN_SIZE,
  starter: "default",
};

/**
 * The storage in GB of a hosted server: the plan storage, and in a boat sandbox not more than its disk.
 * A Starter sandbox from before `HOSTED_BOAT_PLAN_SIZE` is `small` and keeps 12 GB. `size` is the machine
 * after a resize that waits (`pending_size`), else the current one, and null when the server has no row
 * or no boat sandbox yet.
 */
export function hostedServerStorageGb(
  plan: BillingPlanId,
  onOperatorHost: boolean,
  size: HostedServerSize | null,
): number {
  const storageGb = planStorageGb(plan, onOperatorHost);
  if (onOperatorHost || size === null) return storageGb;
  return Math.min(storageGb, HOSTED_SERVER_SIZES[size].diskGb);
}

/**
 * The disk of a hosted server that the system and the preinstalled tools use, in GB (measured on the
 * running servers on 2026-11-09: 19 to 22 GB). The plan storage does not count it: it is on top of the plan.
 */
export const HOSTED_SERVER_BASE_IMAGE_GB = 22;

const GB = 1024 ** 3;

/**
 * The disk of a hosted server against its plan: the total is the plan storage, and the free space is
 * what the plan has left after the files of its users. The free space is never more than the disk has.
 *
 * A host with `storage-user-files-v1` measures the user's files (`userBytes`). A VPS of the operator
 * has a disk much larger than the plan, and its system part is not the base image of a boat sandbox.
 * Without that value, the files of the users are what the disk uses above the base image.
 */
export function hostedPlanDisk(disk: StorageDisk, storageGb: number): StorageDisk {
  const { freeBytes, totalBytes } = disk;
  if (freeBytes === null || totalBytes === null) return disk;
  const planBytes = storageGb * GB;
  const userBytes = disk.userBytes ?? Math.max(0, totalBytes - freeBytes - HOSTED_SERVER_BASE_IMAGE_GB * GB);
  return { freeBytes: Math.max(0, Math.min(freeBytes, planBytes - userBytes)), totalBytes: planBytes };
}

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

const HOSTED_SERVER_CONTACT_SUBJECT = "Custom OpenBot setup";
const HOSTED_SERVER_CONTACT_BODY = [
  "I’d like to discuss a custom OpenBot setup for my needs. Please get in touch so we can explore the available options.",
  "",
  "Here’s some additional context:",
  "",
  "[Tell us what you need]",
].join("\r\n");

/**
 * "Contact us" in the add server dialog, for a plan that the dialog does not have. The email opens
 * with a subject and a short message. The message is in English because the OpenBot team reads it.
 * `encodeURIComponent`, not `URLSearchParams`: mail clients show a `+` as a literal plus sign.
 */
export const HOSTED_SERVER_CONTACT_URL = `mailto:hello@openbot.run?subject=${encodeURIComponent(
  HOSTED_SERVER_CONTACT_SUBJECT,
)}&body=${encodeURIComponent(HOSTED_SERVER_CONTACT_BODY)}`;
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
  /** The storage of the server in GB. An account server from before this field sends none: see `serverStorageGb`. */
  storageGb?: number;
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
    // A value that this app cannot read is left out, so the server still shows with the storage of its plan.
    ...(isStorageGb(value.storageGb) ? { storageGb: value.storageGb } : {}),
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

/** Where the user opened the plan picker. Analytics only; it does not change the checkout. */
export const HOSTED_SERVER_ENTRY_POINTS = [
  "server_rail",
  "settings_billing",
  "upsell",
  "empty_state",
  "checkout_resume",
  "drawer",
  "onboarding",
  "pricing_page",
] as const;
export type HostedServerEntryPoint = (typeof HOSTED_SERVER_ENTRY_POINTS)[number];

export interface CreateHostedServerInput {
  name: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  /** One ID for each opened create form, so a repeated submit does not create a second server. */
  requestId: string;
  /** Older clients do not send it. */
  entryPoint?: HostedServerEntryPoint;
  /**
   * A license to buy with the server, at the bundle price, in the same Checkout and payment. It has the
   * interval and currency of the server. Absent: the server only.
   */
  license?: LicenseOrder;
}

/**
 * The account server's answer to a create or a new payment page. `checkoutUrl` is the Stripe Checkout
 * page, or null when the server needs no payment page (its plan started already).
 */
export interface HostedServerCheckout {
  server: HostedServerSummary;
  checkoutUrl: string | null;
}

/**
 * The prices of a plan. Every plan has the base currencies. An optional currency (BRL) is there only when the
 * Stripe Price has it, and an account server before BRL never sends it.
 */
export type HostedServerPlanPrices = Record<BillingBaseCurrency, Record<BillingInterval, number>> &
  Partial<Record<BillingCurrency, Record<BillingInterval, number>>>;

/** One plan as the create dialog shows it. Amounts are in the minor unit of the currency. */
export interface HostedServerCatalogPlan {
  id: BillingPlanId;
  diskGb: number;
  memberLimit: number;
  relativeSpeed: number;
  prices: HostedServerPlanPrices;
  /** No new server can take this plan. Older account servers do not send it. */
  soldOut?: boolean;
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
  const input: CreateHostedServerInput = {
    name,
    plan: value.plan,
    interval: value.interval,
    currency: value.currency,
    requestId: value.requestId,
  };
  // An unknown entry point is left out, not refused: it is analytics only.
  if (isOneOf(HOSTED_SERVER_ENTRY_POINTS, value.entryPoint)) input.entryPoint = value.entryPoint;
  if (value.license !== undefined) {
    const license = parseLicenseOrder(value.license);
    if (!license) return null;
    input.license = license;
  }
  return input;
}

/** Returns null for a value that is not a checkout answer, or whose URL is not a Stripe Checkout page. */
export function parseHostedServerCheckout(value: unknown): HostedServerCheckout | null {
  if (!isDynamicRecord(value)) return null;
  const server = parseHostedServerSummary(value.server);
  if (!server || !(value.checkoutUrl === null || isStripeCheckoutUrl(value.checkoutUrl))) return null;
  return { server, checkoutUrl: value.checkoutUrl };
}

function parsePlanPrice(value: unknown): Record<BillingInterval, number> | null {
  if (!isDynamicRecord(value) || !isBillingAmount(value.month) || !isBillingAmount(value.year)) return null;
  return { month: value.month, year: value.year };
}

/** A plan needs the base currencies. An optional currency that is missing or not valid is left out. */
function parsePlanPrices(value: unknown): HostedServerPlanPrices | null {
  if (!isDynamicRecord(value)) return null;
  const eur = parsePlanPrice(value.eur);
  const usd = parsePlanPrice(value.usd);
  const pln = parsePlanPrice(value.pln);
  if (!eur || !usd || !pln) return null;
  const prices: HostedServerPlanPrices = { eur, usd, pln };
  for (const currency of BILLING_OPTIONAL_CURRENCIES) {
    const price = parsePlanPrice(value[currency]);
    if (price) prices[currency] = price;
  }
  return prices;
}

/**
 * The currencies that an order of these plans can use: the base currencies, and each optional currency that
 * every plan has. With no plans, only the base currencies.
 */
export function catalogCurrencies(plans: readonly HostedServerCatalogPlan[]): BillingCurrency[] {
  const optional = BILLING_OPTIONAL_CURRENCIES.filter(
    (currency) => plans.length > 0 && plans.every((plan) => plan.prices[currency] !== undefined),
  );
  return BILLING_CURRENCIES.filter(
    (currency) => isOneOf(BILLING_BASE_CURRENCIES, currency) || isOneOf(optional, currency),
  );
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
    const plan: HostedServerCatalogPlan = {
      id: entry.id,
      diskGb: entry.diskGb,
      memberLimit: entry.memberLimit,
      relativeSpeed: entry.relativeSpeed,
      prices,
    };
    if (entry.soldOut === true) plan.soldOut = true;
    plans.push(plan);
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

/**
 * A one-time claim that signs a new server in to the account of the user that made it. The
 * account service answers `POST /v2/server-claims` with it. It works once, until `expiresAt`.
 */
export interface ServerClaim {
  claim: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** The account service makes 32 random bytes in base64url. The claim goes into a shell command, so only these characters. */
const SERVER_CLAIM_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function parseServerClaim(value: unknown): ServerClaim | null {
  if (!isDynamicRecord(value) || !isString(value.claim) || !SERVER_CLAIM_PATTERN.test(value.claim)) return null;
  if (!isNumber(value.expiresAt) || !Number.isFinite(value.expiresAt)) return null;
  return { claim: value.claim, expiresAt: value.expiresAt };
}

/** The install script of a self-hosted server (`scripts/install-server.sh`, docs/self-hosted-server.md). */
export const INSTALL_SERVER_SCRIPT_URL =
  "https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh";

/** A word for a POSIX shell: in single quotes, with each single quote closed, escaped and opened again. */
function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The one command that installs OpenBot on a Linux server and signs it in with the claim. With a
 * name, the server gets that name; without one, the install script names it OpenBot.
 *
 * The claim goes to bash on standard input, as a line before the script. sudo logs its arguments
 * and each variable that it passes (`ENV=`), and `ps` shows the arguments to each user.
 */
export function installServerCommand(claim: string, name?: string): string {
  const named = name === undefined ? "" : ` -- --name ${shellWord(name)}`;
  return `{ echo OPENBOT_CLAIM=${claim}; curl -fsSL ${INSTALL_SERVER_SCRIPT_URL}; } | sudo bash -s${named}`;
}

const SERVER_INSTALL_ITEM_TYPE_PREFIX = "server-install:";
/** The item type of a chat message holds at most 128 characters. */
const ITEM_TYPE_LIMIT = 128;

/**
 * An install command that an agent made in a chat. The chat card waits for the new server. It never
 * holds the claim: the message stays in the chat after the claim is spent.
 */
export interface ServerInstallEvent {
  /** When the command stops working, in milliseconds since the epoch. */
  expiresAt: number;
  /** The name that the command gives the server. Null when it does not fit the item type. */
  name: string | null;
}

export function serverInstallItemType(event: ServerInstallEvent): string {
  if (!Number.isSafeInteger(event.expiresAt) || event.expiresAt < 0) throw new Error("A valid expiry is required.");
  const base = `${SERVER_INSTALL_ITEM_TYPE_PREFIX}${event.expiresAt}:`;
  const named = event.name === null ? base : `${base}${encodeURIComponent(event.name)}`;
  return named.length <= ITEM_TYPE_LIMIT ? named : base;
}

export function serverInstallEvent(message: ConversationMessage): ServerInstallEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(SERVER_INSTALL_ITEM_TYPE_PREFIX)) return null;
  const match = /^([0-9]{1,16}):(.*)$/su.exec(message.itemType.slice(SERVER_INSTALL_ITEM_TYPE_PREFIX.length));
  if (!match?.[1] || match[2] === undefined) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt)) return null;
  if (!match[2]) return { expiresAt, name: null };
  try {
    return { expiresAt, name: parseHostedServerName(decodeURIComponent(match[2])) };
  } catch {
    return null;
  }
}
