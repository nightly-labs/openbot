import {
  BILLING_STORAGE_UPGRADE_TIERS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  type BillingServerPlan,
  type BillingState,
  type BillingStorageTier,
  type BillingStorageUpgrade,
  billingListPrices,
  storageTierGb,
  storageTierListPrices,
} from "@openbot/contracts/billing";
import type { BillingDetails } from "@openbot/contracts/billing-details";
import type { BillingDesktopApi } from "@openbot/contracts/ipc";

const DAY = 24 * 60 * 60_000;

interface PreviewStoragePlan {
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
}

function previewAmount(plan: PreviewStoragePlan, tier: BillingStorageTier): number {
  const base = billingListPrices(plan.plan, plan.interval)[plan.currency];
  return tier === 0 ? base : base + storageTierListPrices(plan.plan, tier, plan.interval)[plan.currency];
}

export function previewStorageFields(
  plan: PreviewStoragePlan,
  tier: BillingStorageTier,
): Pick<BillingServerPlan, "storageGb" | "amount" | "storageUpgrades"> {
  return {
    storageGb: storageTierGb(plan.plan, tier),
    amount: previewAmount(plan, tier),
    storageUpgrades: BILLING_STORAGE_UPGRADE_TIERS.filter((next) => next > tier).map(
      (next): BillingStorageUpgrade => ({
        tier: next,
        storageGb: storageTierGb(plan.plan, next),
        amount: previewAmount(plan, next),
      }),
    ),
  };
}

export function previewBillingServers(now = Date.now()): BillingServerPlan[] {
  return [
    {
      subscriptionId: "sub_preview_office",
      serverId: "host-office",
      serverName: "Office server",
      plan: "standard",
      interval: "year",
      currency: "eur",
      status: "active",
      currentPeriodEnd: now + 200 * DAY,
      cancelAtPeriodEnd: false,
      ...previewStorageFields({ plan: "standard", interval: "year", currency: "eur" }, 0),
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

export function createMockBilling(
  servers: BillingServerPlan[] = previewBillingServers(),
  savedDetails: BillingDetails = { country: "PL", vatId: null },
): BillingDesktopApi {
  const state: BillingState = { available: true, hasCustomer: servers.length > 0, servers };
  let details: BillingDetails = { ...savedDetails };
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
    buyStorage: async (request) => {
      const index = servers.findIndex((server) => server.subscriptionId === request.subscriptionId);
      const server = servers[index];
      if (!server?.storageUpgrades?.some((upgrade) => upgrade.tier === request.tier)) {
        throw new Error("This storage cannot be added to the server.");
      }
      servers[index] = { ...server, ...previewStorageFields(server, request.tier) };
      return structuredClone(state);
    },
    getDetails: async () => ({ ...details }),
    setDetails: async (request) => {
      details = { country: request.country, vatId: request.vatId ?? null };
      return { ...details };
    },
  };
}
