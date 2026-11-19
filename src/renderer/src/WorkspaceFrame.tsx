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
    compact: boolean;
    hidden?: boolean;
    blockedServer: ServerSummary | null;
    onRetryServer: (serverId: string) => Promise<void>;
    left: JSX.Element;
    windowPage: WindowPage;
    page?: JSX.Element;
    connection?: JSX.Element;
    initialLoading?: boolean;
    after?: JSX.Element;
  } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">
>;

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
    "page",
    "after",
    "children",
    "connection",
    "initialLoading",
    "class",
  );

  const compactWidth = () => props.compact && (!pageOpen() || layout.leftPanelNarrow());

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
          "app-frame-sidebar-closed": layout.sidebarClosed(),
          "app-frame-edge": platform.appInfo() !== null,
          "app-frame-with-server-rail": layout.serverRailVisible(),
          "app-frame-page-open": pageOpen(),
          "app-frame-platform-darwin": platform.appInfo()?.platform === "darwin",
        },
      ]}
      aria-hidden={props.hidden ? "true" : undefined}
      style={`--left-panel-width: ${compactWidth() ? LEFT_PANEL_COMPACT : layout.leftPanelWidth()}px`}
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
