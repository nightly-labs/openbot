import type { BillingPlanId } from "@openbot/contracts/billing";
import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export const HOSTED_PLAN_TEXT = {
  starter: { name: "mobile.server.hosted.plan.starter", summary: "mobile.server.hosted.plan.starterSummary" },
  standard: { name: "mobile.server.hosted.plan.standard", summary: "mobile.server.hosted.plan.standardSummary" },
  pro: { name: "mobile.server.hosted.plan.pro", summary: "mobile.server.hosted.plan.proSummary" },
} as const satisfies Record<BillingPlanId, { name: MobileTextKey; summary: MobileTextKey }>;

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
    case "stopping":
    case "stopped":
      return listed && server.error === null ? "ready" : "error";
    default:
      return "error";
  }
}

export function hostedSetupSettled(status: HostedSetupStatus): boolean {
  return status === "ready" || status === "error";
}

export function hostedServerInSetup(server: HostedServerSummary, listed: boolean): boolean {
  if (server.restoring && listed) return false;
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
