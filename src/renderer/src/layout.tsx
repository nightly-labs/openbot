import type { AppInfo } from "@openbot/contracts/ipc";
import type { ServerView } from "@openbot/ui/features/servers/ServerMenu";
import { SIDEBAR_CHAT_ORDERS, type SidebarChatOrder } from "@openbot/ui/features/sidebar/sidebar-types";
import {
  PAGE_RAIL_HIDEABLE_ITEMS,
  PAGE_RAIL_PINNABLE_PAGES,
  type PageRailHideableItem,
  type PageRailPinnablePage,
} from "@openbot/ui/features/window/PageRail";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { z } from "zod";
import { readPanelWidth } from "./components/panel-width-storage";
import {
  CONVERSATION_MIN_WIDTH,
  LEFT_PANEL_CLOSED_STORAGE_KEY,
  LEFT_PANEL_COLLAPSED_STORAGE_KEY,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  LEFT_PANEL_STORAGE_KEY,
  MAC_SERVER_RAIL_WIDTH,
  NARROW_SERVER_RAIL_WIDTH,
  RAIL_HIDDEN_STORAGE_KEY,
  RAIL_PINS_STORAGE_KEY,
  SERVER_RAIL_WIDTH,
  SERVER_VIEW_STORAGE_KEY,
  SIDEBAR_CHAT_ORDER_STORAGE_KEY,
} from "./layout-constants";
import { usePlatform } from "./platform";
import { createSimpleContext } from "./simple-context";

function shouldAutoCompactSidebar(
  platform: AppInfo["platform"] | undefined,
  panelWidth: number,
  serverView: ServerView,
): boolean {
  const serverRailWidth =
    platform === undefined || serverView === "menu"
      ? 0
      : platform === "darwin"
        ? MAC_SERVER_RAIL_WIDTH
        : window.innerWidth <= 800
          ? NARROW_SERVER_RAIL_WIDTH
          : SERVER_RAIL_WIDTH;
  return window.innerWidth - serverRailWidth - panelWidth < CONVERSATION_MIN_WIDTH;
}

const RAIL_PINNED_BY_DEFAULT: ReadonlySet<PageRailPinnablePage> = new Set([
  "tasks",
  "workflows",
  "usage",
  "library",
  "crm",
]);

const railPinChoicesSchema = z.record(z.string(), z.boolean().optional().catch(undefined));

type RailPinChoices = z.infer<typeof railPinChoicesSchema>;

function readRailChoices(key: string): RailPinChoices {
  try {
    const parsed = railPinChoicesSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function readRailPinChoices(): RailPinChoices {
  return readRailChoices(RAIL_PINS_STORAGE_KEY);
}

function readRailHiddenChoices(): RailPinChoices {
  return readRailChoices(RAIL_HIDDEN_STORAGE_KEY);
}

function readSidebarChatOrder(): SidebarChatOrder {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY);
    return SIDEBAR_CHAT_ORDERS.find((order) => order === saved) ?? "unread-group";
  } catch {
    return "unread-group";
  }
}

const Layout = createSimpleContext({
  name: "Layout",
  init: () => {
    const platform = usePlatform();
    const [leftPanelWidth, setLeftPanelWidth] = createSignal(
      readPanelWidth(LEFT_PANEL_STORAGE_KEY, LEFT_PANEL_DEFAULT, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
    );
    const [leftPanelCollapsed, setLeftPanelCollapsed] = createSignal(
      window.localStorage.getItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY) === "true",
    );
    const [serverView, setServerViewSignal] = createSignal<ServerView>(
      window.localStorage.getItem(SERVER_VIEW_STORAGE_KEY) === "rail" ? "rail" : "menu",
    );
    const [sidebarChatOrder, setSidebarChatOrderSignal] = createSignal<SidebarChatOrder>(readSidebarChatOrder());
    const [railPinChoices, setRailPinChoices] = createSignal<RailPinChoices>(readRailPinChoices());
    const railPinned = createMemo(() => {
      const choices = railPinChoices();
      return PAGE_RAIL_PINNABLE_PAGES.filter((page) => choices[page] ?? RAIL_PINNED_BY_DEFAULT.has(page));
    });
    const [railHiddenChoices, setRailHiddenChoices] = createSignal<RailPinChoices>(readRailHiddenChoices());
    const railHidden = createMemo(() => {
      const choices = railHiddenChoices();
      return PAGE_RAIL_HIDEABLE_ITEMS.filter((item) => choices[item] === true);
    });
    const [leftPanelAutoCompact, setLeftPanelAutoCompact] = createSignal(false);
    const [sidebarClosed, setSidebarClosedSignal] = createSignal(
      window.localStorage.getItem(LEFT_PANEL_CLOSED_STORAGE_KEY) === "true",
    );
    const leftPanelNarrow = createMemo(() => leftPanelCollapsed() || leftPanelAutoCompact());
    const leftPanelCompact = createMemo(() => sidebarClosed() || leftPanelNarrow());
    const serverRailVisible = createMemo(
      () => platform.appInfo() !== null && platform.chatWindow === null && serverView() === "rail",
    );

    function updateResponsiveSidebar(): void {
      setLeftPanelAutoCompact(shouldAutoCompactSidebar(platform.appInfo()?.platform, leftPanelWidth(), serverView()));
    }

    createEffect(
      () => ({ osPlatform: platform.appInfo()?.platform, panelWidth: leftPanelWidth(), view: serverView() }),
      ({ osPlatform, panelWidth, view }) => {
        setLeftPanelAutoCompact(shouldAutoCompactSidebar(osPlatform, panelWidth, view));
      },
    );

    onSettled(() => {
      window.addEventListener("resize", updateResponsiveSidebar);
      return () => window.removeEventListener("resize", updateResponsiveSidebar);
    });

    function readRailPinsFromStorage(event: StorageEvent): void {
      if (event.key === null || event.key === RAIL_PINS_STORAGE_KEY) setRailPinChoices(readRailPinChoices());
      if (event.key === null || event.key === RAIL_HIDDEN_STORAGE_KEY) setRailHiddenChoices(readRailHiddenChoices());
      if (event.key === null || event.key === SIDEBAR_CHAT_ORDER_STORAGE_KEY)
        setSidebarChatOrderSignal(readSidebarChatOrder());
    }

    onSettled(() => {
      window.addEventListener("storage", readRailPinsFromStorage);
      return () => window.removeEventListener("storage", readRailPinsFromStorage);
    });

    function setSidebarCollapsed(collapsed: boolean): void {
      setLeftPanelCollapsed(collapsed);
      window.localStorage.setItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
    }

    function setSidebarClosed(closed: boolean): void {
      setSidebarClosedSignal(closed);
      window.localStorage.setItem(LEFT_PANEL_CLOSED_STORAGE_KEY, String(closed));
    }

    function setServerView(view: ServerView): void {
      setServerViewSignal(view);
      window.localStorage.setItem(SERVER_VIEW_STORAGE_KEY, view);
    }

    function setSidebarChatOrder(order: SidebarChatOrder): void {
      setSidebarChatOrderSignal(order);
      try {
        window.localStorage.setItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY, order);
      } catch {}
    }

    function setRailPinned(page: PageRailPinnablePage, pinned: boolean): void {
      const choices = { ...railPinChoices(), ...readRailPinChoices(), [page]: pinned };
      setRailPinChoices(choices);
      try {
        window.localStorage.setItem(RAIL_PINS_STORAGE_KEY, JSON.stringify(choices));
      } catch {}
    }

    function setRailHidden(item: PageRailHideableItem, hidden: boolean): void {
      const choices = { ...railHiddenChoices(), ...readRailHiddenChoices(), [item]: hidden };
      setRailHiddenChoices(choices);
      try {
        window.localStorage.setItem(RAIL_HIDDEN_STORAGE_KEY, JSON.stringify(choices));
      } catch {}
    }

    function expandSidebar(): void {
      setSidebarClosed(false);
      setSidebarCollapsed(false);
      setLeftPanelAutoCompact(false);
    }

    return {
      leftPanelWidth,
      setLeftPanelWidth,
      leftPanelCompact,
      leftPanelNarrow,
      setSidebarCollapsed,
      sidebarClosed,
      setSidebarClosed,
      expandSidebar,
      serverView,
      setServerView,
      serverRailVisible,
      sidebarChatOrder,
      setSidebarChatOrder,
      railPinned,
      setRailPinned,
      railHidden,
      setRailHidden,
    };
  },
});

export const LayoutProvider = Layout.provider;
export const useLayout = Layout.use;
