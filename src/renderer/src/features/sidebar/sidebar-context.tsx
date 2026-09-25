import type { ServerSummary, SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import {
  normalizeSidebarPeopleOrder,
  readSidebarPeopleOrder,
  type SidebarPeopleOrderByServer,
  writeSidebarPeopleOrder,
} from "./sidebar-people-order";
import { sidebarPort } from "./sidebar-port";
import { createSidebarPreferences } from "./sidebar-preferences";
import { defaultSidebarLayout } from "./sidebar-sections";

/**
 * The shape of the agent list: the host's own section layout, plus the three
 * things the user arranges here and this computer remembers - pinned items,
 * people order and collapsed sections.
 *
 * Those three are stored per server and read under `activeServerId()`, so they
 * are *not* torn down on a switch: `localStorage` holds every server's
 * arrangement at once and switching back has to restore it. The layout is the
 * opposite - it belongs to the host, is refetched on every mount of the keyed
 * server scope, and so is the only piece of this module a switch discards.
 *
 * `removePinnedItemEverywhere` is the one write that ignores the active server.
 * A deleted agent has to lose its pin on every server that pinned it, because
 * nothing will ever re-render that entry into a valid state again.
 *
 * Ungated - see `app-providers.tsx`.
 */
const Sidebar = createSimpleContext({
  name: "Sidebar",
  init: () => {
    const { activeServerId, activeServerSupportsCapability } = useServers();

    const [sidebarLayout, setSidebarLayout] = createSignal<SidebarLayoutSnapshot>(defaultSidebarLayout());
    const [sidebarPeopleOrderByServer, setSidebarPeopleOrderByServer] = createSignal<SidebarPeopleOrderByServer>(
      readSidebarPeopleOrder(),
    );
    const preferences = createSidebarPreferences({ scope: activeServerId });

    const sidebarPeopleOrder = createMemo(() => sidebarPeopleOrderByServer()[activeServerId()] ?? []);

    /** The layout read for a server load, answering the default where the host has no layout to give. */
    function loadLayout(server: ServerSummary | undefined): Promise<SidebarLayoutSnapshot> {
      return serverSupportsCapability(server, "sidebar-layout")
        ? sidebarPort().agent.getSidebarLayout()
        : Promise.resolve(defaultSidebarLayout());
    }

    async function mutateSidebarLayout(action: SidebarLayoutAction): Promise<void> {
      if (!activeServerSupportsCapability("sidebar-layout")) {
        throw new Error("This host does not support sidebar layout changes.");
      }
      const layout = await sidebarPort().agent.mutateSidebarLayout(action);
      setSidebarLayout(layout);
    }

    function reorderSidebarPeople(memberIds: string[]): void {
      const serverId = activeServerId();
      setSidebarPeopleOrderByServer((current) => {
        const order = normalizeSidebarPeopleOrder(memberIds);
        const next = { ...current };
        if (order.length > 0) next[serverId] = order;
        else delete next[serverId];
        writeSidebarPeopleOrder(next);
        return next;
      });
    }

    return {
      sidebarLayout,
      setSidebarLayout,
      loadLayout,
      mutateSidebarLayout,
      ...preferences,
      sidebarPeopleOrder,
      reorderSidebarPeople,
    };
  },
});

export const SidebarProvider = Sidebar.provider;
export const useSidebar = Sidebar.use;
