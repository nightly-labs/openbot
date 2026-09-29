import { BILLING_PLANS } from "@openbot/contracts/billing";
import {
  HOSTED_PLAN_SIZE,
  type HostedServerCatalog,
  type HostedServerState,
  type HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi } from "@openbot/contracts/ipc";

const CREATED_AT = "2026-09-20T09:30:00.000Z";
/** How long each mock step takes (payment, then start), so the list shows the transition states. */
const MOCK_STEP_MS = 4_000;

/** The monthly amounts in minor units, as `scripts/stripe-bootstrap.ts` sets them. A year costs 20% less. */
const MONTHLY_PRICES = {
  starter: { eur: 2_000, usd: 2_500, pln: 9_000 },
  standard: { eur: 5_000, usd: 6_000, pln: 22_000 },
  pro: { eur: 10_000, usd: 12_000, pln: 44_000 },
} as const;

const prices = (monthly: { eur: number; usd: number; pln: number }) => ({
  eur: { month: monthly.eur, year: monthly.eur * 12 * 0.8 },
  usd: { month: monthly.usd, year: monthly.usd * 12 * 0.8 },
  pln: { month: monthly.pln, year: monthly.pln * 12 * 0.8 },
});

/** The Stripe sandbox catalog, for the preview and Storybook. */
export const MOCK_HOSTED_SERVER_CATALOG: HostedServerCatalog = {
  plans: BILLING_PLANS.map((plan) => ({
    id: plan.id,
    diskGb: plan.storageGb,
    memberLimit: plan.memberLimit,
    relativeSpeed: plan.relativeSpeed,
    prices: prices(MONTHLY_PRICES[plan.id]),
  })),
};

/** The state that follows each transition state when its mock step ends. */
const NEXT_STATE: Partial<Record<HostedServerState, HostedServerState>> = {
  awaiting_payment: "starting",
  starting: "running",
  waking: "running",
};

/** One stopped server and one whose plan ended, so the preview shows the start and renew actions. */
export function createMockHostedServers(): HostedServersDesktopApi {
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
    },
  ];
  /** The account server's idempotency key: a repeated create request returns the same server. */
  const requests = new Map<string, string>();
  const update = (serverId: string, change: Partial<HostedServerSummary>): HostedServerSummary => {
    const server = servers.find((entry) => entry.serverId === serverId);
    if (!server) throw new Error("The hosted server does not exist.");
    const next = { ...server, ...change, updatedAt: new Date().toISOString() };
    servers = servers.map((entry) => (entry.serverId === serverId ? next : entry));
    return structuredClone(next);
  };

  return {
    list: async () => {
      const stepStartedBefore = Date.now() - MOCK_STEP_MS;
      const now = new Date().toISOString();
      servers = servers.map((server) => {
        const next = NEXT_STATE[server.state];
        return next && Date.parse(server.updatedAt) <= stepStartedBefore
          ? { ...server, state: next, updatedAt: now }
          : server;
      });
      return structuredClone({ available: true, servers });
    },
    plans: async () => structuredClone(MOCK_HOSTED_SERVER_CATALOG),
    create: async (input) => {
      const earlier = servers.find((entry) => entry.serverId === requests.get(input.requestId));
      if (earlier) return structuredClone(earlier);
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
    // The preview has no payment page: a renewal is paid at once, and a new server waits for its step.
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
      if (server.name !== confirmName) throw new Error("Type the server name to delete it.");
      servers = servers.filter((entry) => entry.serverId !== serverId);
    },
    wake: async (serverId) => update(serverId, { state: "waking" }),
  };
}
