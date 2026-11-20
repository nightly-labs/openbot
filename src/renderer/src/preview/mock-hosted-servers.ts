import {
  BILLING_PLANS,
  type BillingPlanId,
  type BillingServerPlan,
  billingListPrices,
  storageTierGb,
} from "@openbot/contracts/billing";
import {
  HOSTED_PLAN_SIZE,
  type HostedServerCatalog,
  type HostedServerState,
  type HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi } from "@openbot/contracts/ipc";

import { sourceText } from "@openbot/i18n/source";

const CREATED_AT = "2026-09-20T09:30:00.000Z";
const MOCK_STEP_MS = 4_000;
const MOCK_MAX_SERVERS = 50;

function prices(plan: BillingPlanId) {
  const month = billingListPrices(plan, "month");
  const year = billingListPrices(plan, "year");
  return {
    eur: { month: month.eur, year: year.eur },
    usd: { month: month.usd, year: year.usd },
    pln: { month: month.pln, year: year.pln },
    brl: { month: month.brl, year: year.brl },
  };
}

export const MOCK_HOSTED_SERVER_CATALOG: HostedServerCatalog = {
  plans: BILLING_PLANS.map((plan) => ({
    id: plan.id,
    diskGb: storageTierGb(plan.id, 0),
    memberLimit: plan.memberLimit,
    relativeSpeed: plan.relativeSpeed,
    prices: prices(plan.id),
  })),
};

const NEXT_STATE: Partial<Record<HostedServerState, HostedServerState>> = {
  awaiting_payment: "starting",
  starting: "running",
  waking: "running",
  stopping: "waking",
};

export function createMockHostedServers(billingPlans?: BillingServerPlan[]): HostedServersDesktopApi {
  let servers: HostedServerSummary[] = [
    {
      serverId: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
      name: "Research server",
      size: "small",
      plan: "starter",
      interval: "month",
      currency: "eur",
      state: "stopped",
      error: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      serverId: "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d",
      name: "Team server",
      size: "default",
      plan: "standard",
      interval: "year",
      currency: "usd",
      state: "stopped",
      error: "plan_ended",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      dataKeptUntil: Date.now() + 12 * 24 * 60 * 60_000,
    },
  ];
  if (billingPlans) {
    servers = billingPlans.flatMap((plan): HostedServerSummary[] =>
      plan.serverId
        ? [
            {
              serverId: plan.serverId,
              name: plan.serverName ?? "Archive server",
              plan: plan.plan,
              size: HOSTED_PLAN_SIZE[plan.plan],
              interval: plan.interval,
              currency: plan.currency,
              state: "running",
              error: null,
              createdAt: CREATED_AT,
              updatedAt: CREATED_AT,
            },
          ]
        : [],
    );
  }
  const removePlan = (serverId: string) => {
    if (billingPlans)
      billingPlans.splice(0, billingPlans.length, ...billingPlans.filter((plan) => plan.serverId !== serverId));
  };
  const requests = new Map<string, string>();
  const update = (serverId: string, change: Partial<HostedServerSummary>): HostedServerSummary => {
    const server = servers.find((entry) => entry.serverId === serverId);
    if (!server) throw new Error("The hosted server does not exist.");
    const next = { ...server, ...change, updatedAt: new Date().toISOString() };
    servers = servers.map((entry) => (entry.serverId === serverId ? next : entry));
    return structuredClone(next);
  };

  return {
    async lifecycle(input) {
      const server = servers.find((entry) => entry.serverId === input.serverId);
      if (!server) throw new Error("The hosted server does not exist.");
      if (input.action === "delete") {
        if (input.confirmName !== server.name) throw new Error(sourceText("error.billing.confirmMismatch"));
        if (input.timing === "now") {
          removePlan(input.serverId);
          servers = servers.filter((entry) => entry.serverId !== input.serverId);
          return;
        }
      }
      const plan = billingPlans?.find((entry) => entry.serverId === input.serverId);
      if (billingPlans && !plan) throw new Error(sourceText("error.billing.lifecycleFailed"));
      if (plan) plan.cancelAtPeriodEnd = input.action !== "keep";
      if (input.action !== "cancel") {
        update(input.serverId, {
          deletionScheduledAt: input.action === "delete" ? (plan?.currentPeriodEnd ?? Date.UTC(2026, 10, 8, 12)) : null,
        });
      }
    },
    list: async () => {
      const stepStartedBefore = Date.now() - MOCK_STEP_MS;
      const now = new Date().toISOString();
      servers = servers.map((server) => {
        const next = NEXT_STATE[server.state];
        return next && Date.parse(server.updatedAt) <= stepStartedBefore
          ? { ...server, state: next, updatedAt: now }
          : server;
      });
      return structuredClone({ available: true, lifecycleAvailable: true, servers, maxServers: MOCK_MAX_SERVERS });
    },
    plans: async () => structuredClone(MOCK_HOSTED_SERVER_CATALOG),
    create: async (input) => {
      const earlier = servers.find((entry) => entry.serverId === requests.get(input.requestId));
      if (earlier) return structuredClone(earlier);
      const unpaid = servers.find((entry) => entry.state === "awaiting_payment");
      if (unpaid) {
        requests.set(input.requestId, unpaid.serverId);
        const { plan, interval, currency } = input;
        return update(unpaid.serverId, { plan, interval, currency, size: HOSTED_PLAN_SIZE[plan] });
      }
      if (servers.length >= MOCK_MAX_SERVERS) throw new Error("This account has the maximum number of servers.");
      const now = new Date().toISOString();
      const server: HostedServerSummary = {
        serverId: crypto.randomUUID(),
        name: input.name,
        size: HOSTED_PLAN_SIZE[input.plan],
        plan: input.plan,
        interval: input.interval,
        currency: input.currency,
        state: "awaiting_payment",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      servers = [...servers, server];
      requests.set(input.requestId, server.serverId);
      return structuredClone(server);
    },
    openCheckout: async (serverId) =>
      update(
        serverId,
        servers.some((entry) => entry.serverId === serverId && entry.error === "plan_ended")
          ? { state: "waking", error: null }
          : {},
      ),
    delete: async ({ serverId, confirmName }) => {
      const server = servers.find((entry) => entry.serverId === serverId);
      if (!server) throw new Error("The hosted server does not exist.");
      if (server.name !== confirmName) throw new Error(sourceText("error.billing.confirmMismatch"));
      removePlan(serverId);
      servers = servers.filter((entry) => entry.serverId !== serverId);
    },
    wake: async (serverId) => update(serverId, { state: "waking" }),
    restart: async (serverId) => update(serverId, { state: "stopping" }),
    createServerClaim: async () => ({
      claim: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      expiresAt: Date.now() + 15 * 60_000,
    }),
  };
}
