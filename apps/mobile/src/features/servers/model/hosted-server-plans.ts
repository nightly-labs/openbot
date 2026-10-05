import type { BillingCurrency, BillingInterval, BillingPlanId } from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan, HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { AppFormat } from "@openbot/i18n/mobile";

/** The plan that shows "Best value" and that the screen selects first, as on desktop. */
export const RECOMMENDED_HOSTED_PLAN: BillingPlanId = "standard";

/**
 * The euro countries, by ISO 3166 region. A phone that reports no currency uses its region; a
 * country that is not here pays in USD. The user can change the currency.
 */
const EURO_REGIONS = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PT",
  "SK",
  "SI",
  "ES",
]);

/** The first currency: the phone's own when the plans have it, else from its region. */
export function guessHostedCurrency(currencyCode: string | null, region: string | null): BillingCurrency {
  const code = currencyCode?.toLowerCase();
  if (code === "eur" || code === "usd" || code === "pln") return code;
  const upper = region?.toUpperCase() ?? "";
  if (upper === "PL") return "pln";
  return EURO_REGIONS.has(upper) ? "eur" : "usd";
}

/** The price of one month in minor units. On yearly billing it is the yearly price divided by 12. */
export function hostedMonthlyAmount(
  plan: HostedServerCatalogPlan,
  interval: BillingInterval,
  currency: BillingCurrency,
): number {
  const prices = plan.prices[currency];
  return interval === "year" ? prices.year / 12 : prices.month;
}

/**
 * How much less yearly billing costs than twelve monthly payments, in whole percent. It is the
 * smallest discount of the plans, so the text is true for each plan. 0 means no discount.
 */
export function hostedYearlyDiscountPercent(
  plans: readonly HostedServerCatalogPlan[],
  currency: BillingCurrency,
): number {
  const discounts = plans.map((plan) => {
    const twelveMonths = plan.prices[currency].month * 12;
    return twelveMonths > 0 ? Math.floor(((twelveMonths - plan.prices[currency].year) * 100) / twelveMonths) : 0;
  });
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

/**
 * A price from minor units, such as "€20" or "zł 90". Hermes may not have the narrow symbol (not
 * confirmed on a device), so a refusal falls back to the regular symbol.
 */
export function formatHostedPrice(format: AppFormat, amount: number, currency: BillingCurrency): string {
  const options = {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  } as const;
  try {
    return format.number(amount / 100, { ...options, currencyDisplay: "narrowSymbol" });
  } catch {
    return format.number(amount / 100, options);
  }
}

/**
 * What the setup screen shows for a new server. `payment`: the server waits for the first payment.
 * `connecting`: the server runs, but this phone does not list it yet.
 */
export type HostedSetupStatus = "payment" | "creating" | "starting" | "connecting" | "ready" | "error";

export function hostedSetupStatus(server: HostedServerSummary, listed: boolean): HostedSetupStatus {
  switch (server.state) {
    case "awaiting_payment":
      return "payment";
    case "creating":
      return "creating";
    case "starting":
    case "waking":
      return "starting";
    case "running":
      return listed ? "ready" : "connecting";
    // A listed server can stop for no use before the user opens it. It starts again on use.
    case "stopping":
    case "stopped":
      return listed && server.error === null ? "ready" : "error";
    default:
      return "error";
  }
}

/** The setup polls until the server is ready or failed. */
export function hostedSetupSettled(status: HostedSetupStatus): boolean {
  return status === "ready" || status === "error";
}

/**
 * A paid server that this phone does not list yet, so the sheet opens on its setup and not on the
 * plans again. A server that failed before it was listed opens too, so the user gets its Retry action
 * and does not buy a second server. A listed server that wakes is not a new server.
 */
export function newestHostedServerInSetup(
  servers: readonly HostedServerSummary[],
  listedIds: ReadonlySet<string>,
): HostedServerSummary | null {
  let newest: HostedServerSummary | null = null;
  for (const server of servers) {
    if (
      server.state !== "creating" &&
      server.state !== "starting" &&
      server.state !== "waking" &&
      // A running server that this phone does not list yet is in its last step, connecting.
      server.state !== "running" &&
      server.state !== "error"
    )
      continue;
    if (listedIds.has(server.serverId)) continue;
    if (!newest || server.createdAt > newest.createdAt) newest = server;
  }
  return newest;
}

/** The servers that block a new one. The account server replaces an unpaid server at the limit. */
export function hostedServerLimit(list: HostedServerList): number | null {
  if (list.maxServers === null) return null;
  const paid = list.servers.filter((server) => server.state !== "awaiting_payment").length;
  return paid >= list.maxServers ? list.maxServers : null;
}

interface RequestKey {
  requestId: string;
  /** Null until the account server answers. */
  serverId: string | null;
}

/**
 * One Idempotency-Key for each plan choice, kept while its server waits for payment. A second tap on
 * the same choice, also after the sheet closed or the request timed out, then gets the same server
 * and not a second server or a second charge.
 */
export class HostedRequestKeys {
  readonly #keys = new Map<string, RequestKey>();

  constructor(private readonly newId: () => string) {}

  /** The key of one choice. It is new only when the choice has no key that waits. */
  keyFor(plan: BillingPlanId, interval: BillingInterval, currency: BillingCurrency): RequestKey {
    const choice = `${plan}:${interval}:${currency}`;
    let key = this.#keys.get(choice);
    if (!key) {
      key = { requestId: this.newId(), serverId: null };
      this.#keys.set(choice, key);
    }
    return key;
  }

  /** Forgets each key whose server no longer waits for payment, so the next choice makes a new server. */
  settle(servers: readonly HostedServerSummary[]): void {
    for (const [choice, key] of this.#keys) {
      if (!key.serverId) continue;
      const waiting = servers.some((server) => server.serverId === key.serverId && server.state === "awaiting_payment");
      if (!waiting) this.#keys.delete(choice);
    }
  }
}
