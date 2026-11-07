import type { HostedServerEntryPoint } from "@openbot/contracts/hosted-servers";
import type { PricingOrder } from "@openbot/contracts/license";
import { createEffect, createSignal } from "solid-js";
import type { AddServerResume } from "../servers/AddServerOverlay";
import { createWebHostedServerCalls } from "./web-hosted-servers";

export interface WebHostedServersOptions {
  accountFetch: typeof fetch;
  /** The hosts of the account. An owned host that comes in starts a read of the hosted servers. */
  hosts: () => readonly { hostId: string; role: string }[];
  /** The add server dialog to open again after the hosting checkout. */
  hostingReturn: () => AddServerResume | null | undefined;
  onHostingReturnConsumed?: (() => void) | undefined;
  /** Opens the join dialog. The plus button opens it when the account cannot create hosted servers. */
  onJoin: () => void;
}

/** The hosted servers of the browser account, and the add server dialog that creates them. */
export function createWebHostedServers(options: WebHostedServersOptions) {
  const calls = createWebHostedServerCalls(options.accountFetch);
  const [addServer, setAddServer] = createSignal<{
    resume: AddServerResume | null;
    entryPoint: HostedServerEntryPoint;
    /** The order from the pricing page. The dialog fills it in and goes on to Checkout. */
    order: PricingOrder | null;
  } | null>(null);
  // True when the account can create hosted servers. The plus button then opens the plans.
  const [available, setAvailable] = createSignal(false);
  /** The hosted servers of this account. The server menu can delete these. */
  const [loaded, setLoaded] = createSignal(false);
  const [hostedIds, setHostedIds] = createSignal<ReadonlySet<string>>(new Set());
  async function refresh(): Promise<boolean> {
    // A failed read keeps the last answer: a network error does not turn the plans off.
    const list = await calls.list().catch(() => null);
    if (!list) return available();
    setAvailable(list.available);
    setLoaded(true);
    setHostedIds(new Set(list.servers.map((server) => server.serverId)));
    return list.available;
  }
  void refresh();
  // A server that the add server dialog creates comes into the host list as an owned host. Each owned
  // host is read once, so its Delete server item shows without a reload.
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
    /** True when the account has a hosted server in any state, also one that waits for payment. */
    ownsHostedServer: () => hostedIds().size > 0,
    /** The add server dialog when it is open, with the checkout that it continues. */
    addServer,
    closeAddServer: () => setAddServer(null),
    /**
     * The plus button opens the add server dialog when the account can create hosted servers, else the
     * join dialog. It uses the last answer, so the click does not wait for the network; the read after it
     * is for the next click.
     */
    openAddServer(entryPoint: HostedServerEntryPoint, order: PricingOrder | null = null): void {
      if (available()) setAddServer({ resume: null, entryPoint, order });
      else options.onJoin();
      void refresh();
    },
  };
}
