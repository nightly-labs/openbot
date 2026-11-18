import type { BillingPlanId } from "@openbot/contracts/billing";
import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { MobileTextKey } from "@openbot/i18n/mobile";

/** The name and the summary of each plan, for the plans sheet and Settings > Billing. */
export const HOSTED_PLAN_TEXT = {
  starter: { name: "mobile.server.hosted.plan.starter", summary: "mobile.server.hosted.plan.starterSummary" },
  standard: { name: "mobile.server.hosted.plan.standard", summary: "mobile.server.hosted.plan.standardSummary" },
  pro: { name: "mobile.server.hosted.plan.pro", summary: "mobile.server.hosted.plan.proSummary" },
} as const satisfies Record<BillingPlanId, { name: MobileTextKey; summary: MobileTextKey }>;

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
 * A server of the account whose setup page has something to show: the payment, the setup steps, or
 * a failure with its Retry action. A listed server that wakes or runs is not in setup.
 */
export function hostedServerInSetup(server: HostedServerSummary, listed: boolean): boolean {
  switch (server.state) {
    case "awaiting_payment":
    case "creating":
    case "starting":
    case "error":
      return true;
    case "waking":
    case "running":
      return !listed;
    default:
      return false;
  }
}
