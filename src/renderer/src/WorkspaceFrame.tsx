import type { ServerSummary } from "@openbot/contracts/ipc";
import { RemoteCompatibilityScreen } from "@openbot/ui/features/remote-desktop/RemoteCompatibilityScreen";
import type { JSX } from "@solidjs/web";
import { omit, type ParentProps, Show } from "solid-js";
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
    /** The rail, the sidebar and the account dock, in paint order. */
    left: JSX.Element;
    /** Whether the usage report is open. While it is, the middle panes are inert. */
    usageOpen: boolean;
    usage?: JSX.Element;
    connection?: JSX.Element;
    initialLoading?: boolean;
    /** Dialogs and overlays after the panes. */
    after?: JSX.Element;
  } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">
>;

/**
 * The application frame that the desktop shell and the web client share: the grid classes, the left
 * column width and its resizer, the compatibility screen, and the usage report slot. The panes come
 * from the caller, because the desktop reads them from its contexts and the web passes props.
 *
 * The order of the children is the paint order the stylesheet expects.
 */
export function WorkspaceFrame(props: WorkspaceFrameProps) {
  const platform = usePlatform();
  const layout = useLayout();
  const rest = omit(
    props,
    "compact",
    "hidden",
    "blockedServer",
    "onRetryServer",
    "left",
    "usageOpen",
    "usage",
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
      class={[
        "app-frame",
        props.class,
        {
          "app-frame-sidebar-compact": props.compact,
          "app-frame-edge": platform.appInfo() !== null,
          "app-frame-with-server-rail": layout.serverRailVisible(),
          "app-frame-usage-open": props.usageOpen,
          "app-frame-platform-darwin": platform.appInfo()?.platform === "darwin",
        },
      ]}
      aria-hidden={props.hidden ? "true" : undefined}
      style={`--left-panel-width: ${props.compact ? LEFT_PANEL_COMPACT : layout.leftPanelWidth()}px`}
    >
      {props.left}
      <WorkspaceLeftPanelResizer />
      <div
        class="usage-workspace-content server-connection-workspace"
        inert={props.usageOpen}
        aria-hidden={props.usageOpen ? "true" : undefined}
      >
        {props.connection}
        <div class="server-connection-content" hidden={props.initialLoading && !props.blockedServer}>
          <Show when={props.blockedServer} keyed fallback={props.children}>
            {(server) => <RemoteCompatibilityScreen server={server} onRetry={() => props.onRetryServer(server.id)} />}
          </Show>
        </div>
      </div>
      <Show when={props.usageOpen}>
        <div class="conversation-panel agent-usage-workspace">{props.usage}</div>
      </Show>
      {props.after}
    </div>
  );
}
