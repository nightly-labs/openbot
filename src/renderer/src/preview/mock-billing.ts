import type { BillingServerPlan, BillingState } from "@openbot/contracts/billing";
import type { BillingDesktopApi } from "@openbot/contracts/ipc";

const DAY = 24 * 60 * 60_000;

/** Three servers of one account: a yearly plan, a plan with a failed payment, and a plan that ends. */
export function previewBillingServers(now = Date.now()): BillingServerPlan[] {
  return [
    {
      subscriptionId: "sub_preview_office",
      serverId: "host-office",
      serverName: "Office server",
      plan: "standard",
      interval: "year",
      currency: "eur",
      amount: 48_000,
      status: "active",
      currentPeriodEnd: now + 200 * DAY,
      cancelAtPeriodEnd: false,
    },
    {
      subscriptionId: "sub_preview_lab",
      serverId: "host-lab",
      serverName: "Lab",
      plan: "pro",
      interval: "month",
      currency: "eur",
      amount: 10_000,
      status: "past_due",
      currentPeriodEnd: now + 5 * DAY,
      cancelAtPeriodEnd: false,
    },
    {
      subscriptionId: "sub_preview_old",
      serverId: "host-old",
      serverName: null,
      plan: "starter",
      interval: "month",
      currency: "eur",
      amount: 2_000,
      status: "active",
      currentPeriodEnd: now + 12 * DAY,
      cancelAtPeriodEnd: true,
    },
  ];
}

/**
 * The account pays for three servers. The Portal calls act as Stripe would after the user confirms:
 * cancel ends the plan at the period end, and the plain Portal renews it.
 */
export function createMockBilling(servers: BillingServerPlan[] = previewBillingServers()): BillingDesktopApi {
  const state: BillingState = { available: true, hasCustomer: servers.length > 0, servers };
  return {
    getState: async () => structuredClone(state),
    openPortal: async (request) => {
      if (request.flow === "update") return;
      servers.splice(
        0,
        servers.length,
        ...servers.map((server) =>
          request.flow === "manage" || server.subscriptionId === request.subscriptionId
            ? { ...server, cancelAtPeriodEnd: request.flow === "cancel" }
            : server,
        ),
      );
    },
  };
}
