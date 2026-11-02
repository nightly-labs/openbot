import type { ServerSummary } from "@openbot/contracts/ipc";
import { RemoteCompatibilityScreen } from "@openbot/ui/features/remote-desktop/RemoteCompatibilityScreen";
import type { JSX } from "@solidjs/web";
import { omit, type ParentProps, Show } from "solid-js";
import { type WindowPage, windowPageKind } from "./features/window/window-page-context";
import { useLayout } from "./layout";
import { LEFT_PANEL_COMPACT } from "./layout-constants";
import { usePlatform } from "./platform";
import { WorkspaceLeftPanelResizer } from "./WorkspaceLeftPanelResizer";

type WorkspaceFrameProps = ParentProps<
  {
    /** Whether the sidebar is drawn compact. The web keeps it wide on a phone, where it is a full pane. */
    compact: boolean;
    /** Set while the remote-desktop workspace covers the frame. */
    hidden?: boolean;
    /** A remote server this build cannot talk to. Its screen replaces the middle panes. */
    blockedServer: ServerSummary | null;
    onRetryServer: (serverId: string) => Promise<void>;
    /** The rails and the sidebar, in paint order. */
    left: JSX.Element;
    /** The page of the rail. A page of another kind than the agents covers the middle panes, and makes them inert. */
    windowPage: WindowPage;
    /** Hides the sidebar below the top row. The middle panes then span it; the server menu stays. */
    sidebarHidden?: boolean;
    page?: JSX.Element;
    connection?: JSX.Element;
    initialLoading?: boolean;
    /** Dialogs and overlays after the panes. */
    after?: JSX.Element;
  } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">
>;

/**
 * The application frame that the desktop shell and the web client share: the grid classes, the left
 * column width and its resizer, the compatibility screen, and the slot of the rail page. The panes come
 * from the caller, because the desktop reads them from its contexts and the web passes props.
 *
 * The order of the children is the paint order the stylesheet expects.
 */
export function WorkspaceFrame(props: WorkspaceFrameProps) {
  const platform = usePlatform();
  const layout = useLayout();
  const pageOpen = () => windowPageKind(props.windowPage) !== "agents";
  const rest = omit(
    props,
    "compact",
    "hidden",
    "blockedServer",
    "onRetryServer",
    "left",
    "windowPage",
    "sidebarHidden",
    "page",
    "after",
    "children",
    "connection",
    "initialLoading",
    "class",
  );

  return (
    <div
      {...rest}
      ref={platform.setAppFrameElement}
      data-window-page={props.windowPage}
      data-window-page-kind={windowPageKind(props.windowPage)}
      class={[
        "app-frame",
        props.class,
        {
          "app-frame-sidebar-compact": props.compact,
          "app-frame-edge": platform.appInfo() !== null,
          "app-frame-with-server-rail": layout.serverRailVisible(),
          "app-frame-page-open": pageOpen(),
          "app-frame-sidebar-hidden": props.sidebarHidden === true,
          "app-frame-platform-darwin": platform.appInfo()?.platform === "darwin",
        },
      ]}
      aria-hidden={props.hidden ? "true" : undefined}
      style={`--left-panel-width: ${props.compact ? LEFT_PANEL_COMPACT : layout.leftPanelWidth()}px`}
    >
      {props.left}
      <WorkspaceLeftPanelResizer />
      <div
        class="app-frame-panes server-connection-workspace"
        inert={pageOpen()}
        aria-hidden={pageOpen() ? "true" : undefined}
      >
        {props.connection}
        <div class="server-connection-content" hidden={props.initialLoading && !props.blockedServer}>
          <Show when={props.blockedServer} keyed fallback={props.children}>
            {(server) => <RemoteCompatibilityScreen server={server} onRetry={() => props.onRetryServer(server.id)} />}
          </Show>
        </div>
      </div>
      <Show when={pageOpen()}>
        <div class="conversation-panel window-page">{props.page}</div>
      </Show>
      {props.after}
    </div>
  );
}
