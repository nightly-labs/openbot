import type { AppInfo } from "@openbot/contracts/ipc";
import type { ServerView } from "@openbot/ui/features/servers/ServerMenu";
import {
  SIDEBAR_CHAT_ORDERS,
  type SidebarChatOrder,
  type SidebarView,
} from "@openbot/ui/features/sidebar/sidebar-types";
import { PAGE_RAIL_PINNABLE_PAGES, type PageRailPinnablePage } from "@openbot/ui/features/window/PageRail";
import { createMemo, createSignal, onSettled } from "solid-js";
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
  RAIL_PINS_STORAGE_KEY,
  SERVER_RAIL_WIDTH,
  SERVER_VIEW_STORAGE_KEY,
  SIDEBAR_CHAT_ORDER_STORAGE_KEY,
  SIDEBAR_VIEW_STORAGE_KEY,
} from "./layout-constants";
import { usePlatform } from "./platform";
import { createSimpleContext } from "./simple-context";

/**
 * The width of the server rail beside the sidebar. macOS reserves space for the traffic lights, and the
 * two platforms that draw a standard OS frame narrow the rail on a small window. A width of `0` means
 * the rail is not drawn: main has not reported the platform yet, or the user chose the server menu.
 */
function serverRailWidthFor(platform: AppInfo["platform"] | undefined, serverView: ServerView, windowWidth: number) {
  if (platform === undefined || serverView === "menu") return 0;
  if (platform === "darwin") return MAC_SERVER_RAIL_WIDTH;
  return windowWidth <= 800 ? NARROW_SERVER_RAIL_WIDTH : SERVER_RAIL_WIDTH;
}

/**
 * The room the sidebar can take while the chat keeps `CONVERSATION_MIN_WIDTH`. The open right panel
 * takes its width first, and it is fixed, so the sidebar gives way before the chat header is squeezed.
 * A value below `LEFT_PANEL_MIN` means even the smallest sidebar does not fit, so it is compact.
 */
function sidebarRoomWidth(
  platform: AppInfo["platform"] | undefined,
  serverView: ServerView,
  windowWidth: number,
  rightPanelWidth: number,
): number {
  return windowWidth - serverRailWidthFor(platform, serverView, windowWidth) - rightPanelWidth - CONVERSATION_MIN_WIDTH;
}

/** The pages in the rail until the user chooses. The others start in the More menu. */
const RAIL_PINNED_BY_DEFAULT: ReadonlySet<PageRailPinnablePage> = new Set(["tasks", "workflows", "usage", "library"]);

// A record, not an object: a page that only another version knows keeps its choice when this version saves.
const railPinChoicesSchema = z.record(z.string(), z.boolean().optional().catch(undefined));

type RailPinChoices = z.infer<typeof railPinChoicesSchema>;

/**
 * The pin choices that the user made on this computer. Only a choice is saved, so a page that a later
 * version adds gets its default. Blocked storage or a damaged value reads as no choice.
 */
function readRailPinChoices(): RailPinChoices {
  try {
    const parsed = railPinChoicesSchema.safeParse(
      JSON.parse(window.localStorage.getItem(RAIL_PINS_STORAGE_KEY) ?? "{}"),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * The saved chat order of the sidebar. Without a choice, unread chats show in a group of their own.
 * Blocked storage or an unknown value reads as no choice.
 */
function readSidebarChatOrder(): SidebarChatOrder {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY);
    return SIDEBAR_CHAT_ORDERS.find((order) => order === saved) ?? "unread-group";
  } catch {
    return "unread-group";
  }
}

/**
 * The width of the workspace sidebar, and the two independent reasons it can be
 * narrow: the user collapsed it, or the window is too small to keep it open.
 *
 * Only the first is persisted. The second is recomputed from the window on every
 * resize and on every platform change, so restoring a wide sidebar into a narrow
 * window compacts it again rather than restoring an unusable layout - and
 * `expandSidebar` clears both, because a user asking for the sidebar back means
 * both reasons at once.
 *
 * The user also chooses how servers are switched: a menu on the server name,
 * which is the default, or a server rail beside the page rail. That choice is
 * persisted on this computer. A compact sidebar hides the server name, so in the
 * menu view the user expands the sidebar to switch servers; the rail does not
 * come back.
 *
 * The user also pins pages to the page rail. Pages that are not pinned are in its More menu. The
 * choice is saved on this computer.
 *
 * The geometry itself is in `layout-constants.ts`; the view imports it directly
 * rather than reading constants through a context.
 */
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
    // The page rail is the left column of the window, so the server menu is the default. The rail
    // shows only for a user who chose it; `setServerView` saves only an explicit choice.
    const [serverView, setServerViewSignal] = createSignal<ServerView>(
      window.localStorage.getItem(SERVER_VIEW_STORAGE_KEY) === "rail" ? "rail" : "menu",
    );
    const [sidebarView, setSidebarViewSignal] = createSignal<SidebarView>(
      window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY) === "routines" ? "routines" : "agents",
    );
    const [sidebarChatOrder, setSidebarChatOrderSignal] = createSignal<SidebarChatOrder>(readSidebarChatOrder());
    const [railPinChoices, setRailPinChoices] = createSignal<RailPinChoices>(readRailPinChoices());
    const railPinned = createMemo(() => {
      const choices = railPinChoices();
      return PAGE_RAIL_PINNABLE_PAGES.filter((page) => choices[page] ?? RAIL_PINNED_BY_DEFAULT.has(page));
    });
    // The width the open right panel takes beside the chat, or 0 when it is closed. The conversation sets it.
    const [rightPanelWidth, setRightPanelWidthSignal] = createSignal(0);
    // The user asked for the sidebar while there is no room. It opens at the smallest width until the
    // right panel changes, so the toggle always works (for example, to switch servers).
    const [leftPanelForcedOpen, setLeftPanelForcedOpen] = createSignal(false);
    function setRightPanelWidth(width: number): void {
      setLeftPanelForcedOpen(false);
      setRightPanelWidthSignal(width);
    }
    const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
    const sidebarRoom = createMemo(() =>
      sidebarRoomWidth(platform.appInfo()?.platform, serverView(), windowWidth(), rightPanelWidth()),
    );
    /** The width the sidebar is drawn at: the width the user chose, but never wider than the room left. */
    const leftPanelShownWidth = createMemo(() => Math.max(LEFT_PANEL_MIN, Math.min(leftPanelWidth(), sidebarRoom())));
    /** The widest the user can drag the sidebar now. It shrinks when the right panel opens. */
    const leftPanelMaxWidth = createMemo(() => Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, sidebarRoom())));
    /** Even the smallest sidebar does not fit beside the chat, so the sidebar is compact unless the user opened it. */
    const leftPanelAutoCompact = createMemo(() => sidebarRoom() < LEFT_PANEL_MIN && !leftPanelForcedOpen());
    // A closed sidebar shows no agent list. A window with no page rail has no room to close it, so
    // there the styles show it compact; that is why closed is also compact.
    const [sidebarClosed, setSidebarClosedSignal] = createSignal(
      window.localStorage.getItem(LEFT_PANEL_CLOSED_STORAGE_KEY) === "true",
    );
    /** The window has no room for the full sidebar. A closed sidebar does not make this true. */
    const leftPanelNarrow = createMemo(() => leftPanelCollapsed() || leftPanelAutoCompact());
    const leftPanelCompact = createMemo(() => sidebarClosed() || leftPanelNarrow());
    /**
     * Whether the window draws the vertical server rail. The frame class and
     * the rail itself need the answer. `appInfo` is null
     * until main answers, and no rail is drawn before then. A chat window
     * shows no rail, so its frame keeps no space for one (#5346).
     */
    const serverRailVisible = createMemo(
      () => platform.appInfo() !== null && platform.chatWindow === null && serverView() === "rail",
    );

    // The window width is a signal, so the sidebar room and the compact state follow a resize.
    onSettled(() => {
      const updateWindowWidth = () => setWindowWidth(window.innerWidth);
      window.addEventListener("resize", updateWindowWidth);
      return () => window.removeEventListener("resize", updateWindowWidth);
    });

    // Another window or browser tab can change the pins or the chat order.
    function readRailPinsFromStorage(event: StorageEvent): void {
      if (event.key === null || event.key === RAIL_PINS_STORAGE_KEY) setRailPinChoices(readRailPinChoices());
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

    function setSidebarView(view: SidebarView): void {
      setSidebarViewSignal(view);
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view);
    }

    function setSidebarChatOrder(order: SidebarChatOrder): void {
      setSidebarChatOrderSignal(order);
      try {
        window.localStorage.setItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY, order);
      } catch {
        // Blocked or full storage keeps the choice for this window only.
      }
    }

    function setRailPinned(page: PageRailPinnablePage, pinned: boolean): void {
      // Start from the saved value, so the choices of another window stay. Blocked storage reads as no choice.
      const choices = { ...railPinChoices(), ...readRailPinChoices(), [page]: pinned };
      setRailPinChoices(choices);
      try {
        window.localStorage.setItem(RAIL_PINS_STORAGE_KEY, JSON.stringify(choices));
      } catch {
        // Blocked or full storage keeps the choice for this window only.
      }
    }

    function expandSidebar(): void {
      setSidebarClosed(false);
      setSidebarCollapsed(false);
      setLeftPanelForcedOpen(true);
    }

    return {
      leftPanelWidth,
      leftPanelShownWidth,
      leftPanelMaxWidth,
      setLeftPanelWidth,
      leftPanelCompact,
      leftPanelNarrow,
      setRightPanelWidth,
      setSidebarCollapsed,
      sidebarClosed,
      setSidebarClosed,
      expandSidebar,
      serverView,
      setServerView,
      serverRailVisible,
      sidebarView,
      setSidebarView,
      sidebarChatOrder,
      setSidebarChatOrder,
      railPinned,
      setRailPinned,
    };
  },
});

export const LayoutProvider = Layout.provider;
export const useLayout = Layout.use;
