import type { AppInfo } from "@openbot/contracts/ipc";
import type { ServerView } from "@openbot/ui/features/servers/ServerMenu";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { readPanelWidth } from "./components/panel-width-storage";
import {
  CONVERSATION_MIN_WIDTH,
  LEFT_PANEL_COLLAPSED_STORAGE_KEY,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  LEFT_PANEL_STORAGE_KEY,
  MAC_SERVER_RAIL_WIDTH,
  NARROW_SERVER_RAIL_WIDTH,
  SERVER_RAIL_WIDTH,
  SERVER_VIEW_STORAGE_KEY,
} from "./layout-constants";
import { usePlatform } from "./platform";
import { createSimpleContext } from "./simple-context";

/**
 * Whether the conversation still has room beside a sidebar of this width. The
 * server rail is part of the arithmetic rather than a style detail, and its
 * width depends on the platform: macOS reserves space for the traffic lights,
 * while the two platforms that draw a standard OS frame narrow the rail on a
 * small window. A width of `0` means the rail is not drawn: main has not reported
 * the platform yet, or the user chose the server menu.
 */
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
 * The user also chooses how servers are switched: the rail down the left edge,
 * which is the default, or a menu on the server name. That choice is persisted
 * on this computer. A compact sidebar hides the server name, so in the menu view
 * the user expands the sidebar to switch servers; the rail does not come back.
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
    const [serverView, setServerViewSignal] = createSignal<ServerView>(
      window.localStorage.getItem(SERVER_VIEW_STORAGE_KEY) === "menu" ? "menu" : "rail",
    );
    const [leftPanelAutoCompact, setLeftPanelAutoCompact] = createSignal(false);
    const leftPanelCompact = createMemo(() => leftPanelCollapsed() || leftPanelAutoCompact());
    /**
     * Whether the window draws the vertical server rail. The frame class, the
     * rail itself and the account dock all need the answer. `appInfo` is null
     * until main answers, and no rail is drawn before then.
     */
    const serverRailVisible = createMemo(() => platform.appInfo() !== null && serverView() === "rail");

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

    function setSidebarCollapsed(collapsed: boolean): void {
      setLeftPanelCollapsed(collapsed);
      window.localStorage.setItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
    }

    function setServerView(view: ServerView): void {
      setServerViewSignal(view);
      window.localStorage.setItem(SERVER_VIEW_STORAGE_KEY, view);
    }

    function expandSidebar(): void {
      setSidebarCollapsed(false);
      setLeftPanelAutoCompact(false);
    }

    return {
      leftPanelWidth,
      setLeftPanelWidth,
      leftPanelCompact,
      setSidebarCollapsed,
      expandSidebar,
      serverView,
      setServerView,
      serverRailVisible,
    };
  },
});

export const LayoutProvider = Layout.provider;
export const useLayout = Layout.use;
