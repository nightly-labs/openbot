import type { ServerSummary, SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { currentText } from "@openbot/ui/text";
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

const Sidebar = createSimpleContext({
  name: "Sidebar",
  init: () => {
    const { servers, activeServerId, activeServerSupportsCapability } = useServers();

    const [sidebarLayout, setSidebarLayout] = createSignal<SidebarLayoutSnapshot>(defaultSidebarLayout());
    const [sidebarPeopleOrderByServer, setSidebarPeopleOrderByServer] = createSignal<SidebarPeopleOrderByServer>(
      readSidebarPeopleOrder(),
    );
    const preferences = createSidebarPreferences({
      scope: activeServerId,
      sync: {
        supports: (serverId) =>
          serverSupportsCapability(
            servers().find((server) => server.id === serverId),
            SIDEBAR_PINS_CAPABILITY,
          ),
        read: (serverId) => sidebarPort().agent.getSidebarPins(serverId),
        set: (serverId, items) => sidebarPort().agent.setSidebarPins({ items }, serverId),
        seed: (serverId, items) => sidebarPort().agent.seedSidebarPins({ items }, serverId),
      },
    });

    const sidebarPeopleOrder = createMemo(() => sidebarPeopleOrderByServer()[activeServerId()] ?? []);

    function loadLayout(server: ServerSummary | undefined): Promise<SidebarLayoutSnapshot | null> {
      if (server?.kind === "remote" && server.compatibility?.hostAppVersion === null) return Promise.resolve(null);
      return serverSupportsCapability(server, "sidebar-layout")
        ? sidebarPort().agent.getSidebarLayout()
        : Promise.resolve(defaultSidebarLayout());
    }

    async function applySidebarLayoutAction(action: SidebarLayoutAction): Promise<SidebarLayoutSnapshot> {
      if (!activeServerSupportsCapability("sidebar-layout")) {
        throw new Error(currentText().t("sidebar.section.layoutUnsupported"));
      }
      const layout = await sidebarPort().agent.mutateSidebarLayout(action);
      setSidebarLayout(layout);
      return layout;
    }

    async function mutateSidebarLayout(action: SidebarLayoutAction): Promise<void> {
      await applySidebarLayoutAction(action);
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
      applySidebarLayoutAction,
      ...preferences,
      sidebarPeopleOrder,
      reorderSidebarPeople,
    };
  },
});

export const SidebarProvider = Sidebar.provider;
export const useSidebar = Sidebar.use;
