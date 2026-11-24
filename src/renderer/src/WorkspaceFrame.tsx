import type { ServerSummary } from "@openbot/contracts/ipc";
import { RemoteCompatibilityScreen } from "@openbot/ui/features/remote-desktop/RemoteCompatibilityScreen";
import { type ServerPaywall, ServerPaywallScreen } from "@openbot/ui/features/servers/ServerPaywall";
import { ServerPlanEndedScreen, serverPlanScreenShown } from "@openbot/ui/features/servers/ServerPlanEnd";
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
    paywall?: ServerPaywall;
    onRetryServer: (serverId: string) => Promise<void>;
    planDeletesAt: (serverId: string) => number | null;
    onRenewPlan?: ((serverId: string) => Promise<void>) | undefined;
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
    "paywall",
    "onRetryServer",
    "planDeletesAt",
    "onRenewPlan",
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
  const planScreenShown = () => serverPlanScreenShown(props.blockedServer, props.planDeletesAt);
  const paywallView = () => {
    const paywall = props.paywall;
    const server = paywall?.server();
    return paywall && server ? { paywall, server } : null;
  };
  const fullScreen = () => planScreenShown() || paywallView() !== null;
  const leftPanelWidth = () => {
    if (fullScreen()) return 0;
    return compactWidth() ? LEFT_PANEL_COMPACT : layout.leftPanelWidth();
  };

  const blockedContent = () => (
    <Show when={props.blockedServer} keyed fallback={props.children}>
      {(server) => (
        <Show
          when={planScreenShown()}
          fallback={<RemoteCompatibilityScreen server={server} onRetry={() => props.onRetryServer(server.id)} />}
        >
          <ServerPlanEndedScreen
            server={server}
            deleteAt={props.planDeletesAt(server.id)}
            onRenew={props.onRenewPlan}
            onRetry={() => void props.onRetryServer(server.id)}
          />
        </Show>
      )}
    </Show>
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
          "app-frame-sidebar-closed": layout.sidebarClosed(),
          "app-frame-edge": platform.appInfo() !== null,
          "app-frame-with-server-rail": layout.serverRailVisible(),
          "app-frame-page-open": pageOpen(),
          "app-frame-platform-darwin": platform.appInfo()?.platform === "darwin",
        },
      ]}
      aria-hidden={props.hidden ? "true" : undefined}
      style={`--left-panel-width: ${leftPanelWidth()}px`}
    >
      {props.left}
      <Show when={!fullScreen()}>
        <WorkspaceLeftPanelResizer />
      </Show>
      <div
        class="app-frame-panes server-connection-workspace"
        inert={pageOpen()}
        aria-hidden={pageOpen() ? "true" : undefined}
      >
        {props.connection}
        <div class="server-connection-content" hidden={props.initialLoading && !props.blockedServer}>
          <Show when={paywallView()} fallback={blockedContent()}>
            {(view) => <ServerPaywallScreen server={view().server} paywall={view().paywall} />}
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
