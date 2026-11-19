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
  type BillingStorageTier,
  hostedPlanStorageGb,
  isBillingAmount,
  isStorageGb,
  isStripeCheckoutUrl,
} from "./billing";
import { INPUT_LIMITS } from "./input-limits";
import type { ConversationMessage } from "./ipc-conversation-messages";
import type { MachineMetrics } from "./ipc-machine-resources";
import type { StorageDisk } from "./ipc-storage";
import { type LicenseOrder, parseLicenseOrder } from "./license";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";
import { slugifyTeamServerName } from "./validation";

export const HOSTED_SERVER_SIZES = {
  small: { vcpu: 2, memoryGb: 4, diskGb: 12 },
  default: { vcpu: 4, memoryGb: 8, diskGb: 50 },
  large: { vcpu: 8, memoryGb: 16, diskGb: 125 },
} as const;

export type HostedServerSize = keyof typeof HOSTED_SERVER_SIZES;

export const HOSTED_SERVER_SIZE_NAMES = ["small", "default", "large"] as const satisfies readonly HostedServerSize[];

export const HOSTED_PLAN_SIZE: Readonly<Record<BillingPlanId, HostedServerSize>> = {
  starter: "small",
  standard: "default",
  pro: "large",
};

export const HOSTED_BOAT_PLAN_SIZE: Readonly<Record<BillingPlanId, HostedServerSize>> = {
  ...HOSTED_PLAN_SIZE,
  starter: "default",
};

export function hostedServerStorageGb(
  plan: BillingPlanId,
  onOperatorHost: boolean,
  size: HostedServerSize | null,
  storageTier: BillingStorageTier,
): number {
  const storageGb = hostedPlanStorageGb(plan, onOperatorHost, storageTier);
  if (onOperatorHost || size === null) return storageGb;
  return Math.min(storageGb, HOSTED_SERVER_SIZES[size].diskGb);
}

export const HOSTED_SERVER_BASE_IMAGE_GB = 22;

const GB = 1024 ** 3;

export function hostedPlanDisk(disk: StorageDisk, storageGb: number): StorageDisk {
  const { freeBytes, totalBytes } = disk;
  if (freeBytes === null || totalBytes === null) return disk;
  const planBytes = storageGb * GB;
  const userBytes = disk.userBytes ?? Math.max(0, totalBytes - freeBytes - HOSTED_SERVER_BASE_IMAGE_GB * GB);
  return { freeBytes: Math.max(0, Math.min(freeBytes, planBytes - userBytes)), totalBytes: planBytes };
}

export function hostedPlanMachineMetrics(
  metrics: MachineMetrics,
  storageGb: number,
  userBytes: number | null,
): MachineMetrics {
  const { freeBytes, totalBytes } = hostedPlanDisk(
    { freeBytes: metrics.diskFreeBytes, totalBytes: metrics.diskTotalBytes, userBytes },
    storageGb,
  );
  if (freeBytes === null || totalBytes === null) return metrics;
  return { ...metrics, diskUsedBytes: totalBytes - freeBytes, diskFreeBytes: freeBytes, diskTotalBytes: totalBytes };
}

export const HOSTED_SERVER_STATES = [
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

export const HOSTED_SERVER_ERRORS = [
  "provider_error",
  "provider_billing",
  "provider_limit",
  "start_failed",
  "plan_ended",
] as const;

export type HostedServerError = (typeof HOSTED_SERVER_ERRORS)[number];

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

export const HOSTED_SERVER_CONTACT_URL = `mailto:hello@openbot.run?subject=${encodeURIComponent(
  HOSTED_SERVER_CONTACT_SUBJECT,
)}&body=${encodeURIComponent(HOSTED_SERVER_CONTACT_BODY)}`;
export const HOSTING_DEVELOPER_KEY_HEADER = "OpenBot-Hosting-Developer-Key";

export interface HostedServerSummary {
  deletionScheduledAt?: number | null;
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
  storageGb?: number;
}

export interface HostedServerStatus {
  serverId: string;
  state: HostedServerState;
  error: HostedServerError | null;
  sleeping: boolean;
}

export interface HostedServerList {
  lifecycleAvailable?: boolean;
  available: boolean;
  servers: HostedServerSummary[];
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
    ...(isStorageGb(value.storageGb) ? { storageGb: value.storageGb } : {}),
  };
}

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
  const state: HostedServerState = isHostedServerState(value.state) ? value.state : "error";
  const error: HostedServerError | null =
    state !== value.state ? "provider_error" : isOneOf(HOSTED_SERVER_ERRORS, value.error) ? value.error : null;
  return { serverId: value.serverId, state, error, sleeping: value.sleeping };
}

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
  requestId: string;
  entryPoint?: HostedServerEntryPoint;
  license?: LicenseOrder;
  earlyStart?: true;
}

export interface HostedServerCheckout {
  server: HostedServerSummary;
  checkoutUrl: string | null;
}

export type HostedServerPlanPrices = Record<BillingBaseCurrency, Record<BillingInterval, number>> &
  Partial<Record<BillingCurrency, Record<BillingInterval, number>>>;

export interface HostedServerCatalogPlan {
  id: BillingPlanId;
  diskGb: number;
  memberLimit: number;
  relativeSpeed: number;
  prices: HostedServerPlanPrices;
  soldOut?: boolean;
}

export interface HostedServerCatalog {
  plans: HostedServerCatalogPlan[];
}

export interface DeleteHostedServerInput {
  serverId: string;
  confirmName: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

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
  if (isOneOf(HOSTED_SERVER_ENTRY_POINTS, value.entryPoint)) input.entryPoint = value.entryPoint;
  if (value.license !== undefined) {
    const license = parseLicenseOrder(value.license);
    if (!license) return null;
    input.license = license;
  }
  if (value.earlyStart === true) input.earlyStart = true;
  return input;
}

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

export function catalogCurrencies(plans: readonly HostedServerCatalogPlan[]): BillingCurrency[] {
  const optional = BILLING_OPTIONAL_CURRENCIES.filter(
    (currency) => plans.length > 0 && plans.every((plan) => plan.prices[currency] !== undefined),
  );
  return BILLING_CURRENCIES.filter(
    (currency) => isOneOf(BILLING_BASE_CURRENCIES, currency) || isOneOf(optional, currency),
  );
}

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

export function parseDeleteHostedServerInput(value: unknown): DeleteHostedServerInput | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !isString(value.confirmName)) return null;
  if (!value.serverId || value.serverId.length > INPUT_LIMITS.identifier) return null;
  if (value.confirmName.length > INPUT_LIMITS.serverName) return null;
  return { serverId: value.serverId, confirmName: value.confirmName };
}

export interface HostedServerActivityReport {
  inUse: boolean;
  nextRunAt?: number | null;
}

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

export interface ServerClaim {
  claim: string;
  expiresAt: number;
}

const SERVER_CLAIM_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function parseServerClaim(value: unknown): ServerClaim | null {
  if (!isDynamicRecord(value) || !isString(value.claim) || !SERVER_CLAIM_PATTERN.test(value.claim)) return null;
  if (!isNumber(value.expiresAt) || !Number.isFinite(value.expiresAt)) return null;
  return { claim: value.claim, expiresAt: value.expiresAt };
}

export const INSTALL_SERVER_SCRIPT_URL =
  "https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh";

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function installServerCommand(claim: string, name?: string): string {
  const named = name === undefined ? "" : ` -- --name ${shellWord(name)}`;
  return `{ echo OPENBOT_CLAIM=${claim}; curl -fsSL ${INSTALL_SERVER_SCRIPT_URL}; } | sudo bash -s${named}`;
}

const SERVER_INSTALL_ITEM_TYPE_PREFIX = "server-install:";
const ITEM_TYPE_LIMIT = 128;

export interface ServerInstallEvent {
  expiresAt: number;
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
