import type { HostedServerEntryPoint } from "@openbot/contracts/hosted-servers";
import type { PricingOrder } from "@openbot/contracts/license";
import { serverPlanDeletionDates } from "@openbot/ui/features/servers/ServerPlanEnd";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AddServerResume } from "../servers/AddServerOverlay";
import { openServerPlanCheckout, refreshEndedPlansOnFocus } from "../servers/ServerPlanReminder";
import { createWebHostedServerCalls } from "./web-hosted-servers";

export interface WebHostedServersOptions {
  accountFetch: typeof fetch;
  hosts: () => readonly { hostId: string; role: string }[];
  hostingReturn: () => AddServerResume | null | undefined;
  onHostingReturnConsumed?: (() => void) | undefined;
  onJoin: () => void;
}

export function createWebHostedServers(options: WebHostedServersOptions) {
  const calls = createWebHostedServerCalls(options.accountFetch);
  const [addServer, setAddServer] = createSignal<{
    resume: AddServerResume | null;
    entryPoint: HostedServerEntryPoint;
    order: PricingOrder | null;
  } | null>(null);
  const [available, setAvailable] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [hostedIds, setHostedIds] = createSignal<ReadonlySet<string>>(new Set());
  const [planDeletesAtById, setPlanDeletesAtById] = createSignal<ReadonlyMap<string, number>>(new Map());
  let listRequest = 0;
  async function refresh(): Promise<boolean> {
    const request = ++listRequest;
    const list = await calls.list().catch(() => null);
    if (!list) return available();
    if (request !== listRequest) return list.available;
    setAvailable(list.available);
    setLoaded(true);
    setHostedIds(new Set(list.servers.map((server) => server.serverId)));
    setPlanDeletesAtById(serverPlanDeletionDates(list.servers));
    return list.available;
  }
  void refresh();
  onCleanup(refreshEndedPlansOnFocus(() => untrack(planDeletesAtById).size > 0, refresh));
  const readOwnedHostIds = new Set<string>();
  createEffect(
    () =>
      options
        .hosts()
        .filter((host) => host.role === "owner" && !readOwnedHostIds.has(host.hostId))
        .map((host) => host.hostId),
    (hostIds) => {
      if (hostIds.length === 0) return;
      for (const hostId of hostIds) readOwnedHostIds.add(hostId);
      void refresh();
    },
  );
  createEffect(options.hostingReturn, (resume) => {
    if (!resume) return;
    setAddServer({ resume, entryPoint: "checkout_resume", order: null });
    options.onHostingReturnConsumed?.();
  });

  return {
    calls,
    available,
    loaded,
    isHosted: (serverId: string) => hostedIds().has(serverId),
    ownsHostedServer: () => hostedIds().size > 0,
    planDeletesAt: (serverId: string) => planDeletesAtById().get(serverId) ?? null,
    refresh,
    renewPlan: (serverId: string) => openServerPlanCheckout(calls.openCheckout, serverId),
    addServer,
    closeAddServer: () => setAddServer(null),
    openAddServer(entryPoint: HostedServerEntryPoint, order: PricingOrder | null = null): void {
      if (available()) setAddServer({ resume: null, entryPoint, order });
      else options.onJoin();
      void refresh();
    },
  };
}
