import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import {
  ConversationLoadNotice,
  ServerConnectionNotice,
  ServerPanelLoadNotice,
  serverWorkspacePhase,
} from "@openbot/ui/features/servers/ServerConnectionNotice";
import { serverPlanBlocks, serverPlanScreenShown } from "@openbot/ui/features/servers/ServerPlanEnd";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useAccountUsagePolling } from "./features/account/account-usage-polling";
import { AgentDockHost, useAgentDockPlacement } from "./features/agent-dock/AgentDockHost";
import { useAgents } from "./features/agents/agents-context";
import { WorkspaceAgentSetup } from "./features/agents/WorkspaceAgentSetup";
import { useChannels } from "./features/channels/channels-context";
import { WorkspaceChannelConversation } from "./features/channels/WorkspaceChannelConversation";
import { ConnectorsProvider } from "./features/connectors/connectors-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { WorkspaceConversation } from "./features/conversation/WorkspaceConversation";
import { WorkspaceDirectConversation } from "./features/conversation/WorkspaceDirectConversation";
import { useCustomAgentUsagePolling } from "./features/custom-agents/custom-agent-usage-polling";
import { serverHasStorage } from "./features/files/storage-usage";
import { WorkspaceServerOnboarding } from "./features/onboarding/WorkspaceServerOnboarding";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { WorkspaceRoutineFlows } from "./features/routine-flows/WorkspaceRoutineFlows";
import { createRoutineTimezonePrompt, desktopRoutineZoneTargets } from "./features/schedule/routine-timezone-prompt";
import { createHostedUpsellOffline } from "./features/servers/hosted-server-upsell-controller";
import { createRemoteSyncMarks } from "./features/servers/remote-sync-marks";
import { renewServerPlan } from "./features/servers/server-actions";
import { serverCanAdminister } from "./features/servers/server-capabilities";
import { createServerConnectionToast } from "./features/servers/server-connection-toast";
import { useServerScope } from "./features/servers/server-scope";
import { followsServerUpdate, ServerUpdateDialogHost } from "./features/servers/server-update-flow";
import { useServers } from "./features/servers/servers-context";
import { WorkspaceServerRail } from "./features/servers/WorkspaceServerRail";
import { useSettings } from "./features/settings/settings-context";
import { WorkspaceSidebar } from "./features/sidebar/WorkspaceSidebar";
import { TasksPanel } from "./features/tasks/TasksPanel";
import { createHostRestartToasts, type HostRestartView, noteServerAgents } from "./features/updates/host-restart-toast";
import { useUsage } from "./features/usage/usage-context";
import { finishRestartedStart, startsAfterRestart } from "./features/window/restarted-start";
import { WindowBackdrop } from "./features/window/WindowBackdrop";
import { WindowPageView } from "./features/window/WindowPageView";
import { WorkspacePageRail } from "./features/window/WorkspacePageRail";
import { useWindowPage } from "./features/window/window-page-context";
import { useLayout } from "./layout";
import { usePlatform } from "./platform";
import { WorkspaceFrame } from "./WorkspaceFrame";
import { WorkspaceOverlays } from "./WorkspaceOverlays";

export function WorkspaceShell(props: {
  account: () => CentralAuthUser;
  behindSplash?: () => boolean;
  onStartupReady?: () => void;
}) {
  const platform = usePlatform();
  const chatWindow = platform.chatWindow !== null;
  const { sourceText, t } = useText();
  const scope = useServerScope();
  const settings = useSettings();
  const channels = useChannels();
  const channelOpen = () => channels.state.selectedId !== null;
  const windowPage = useWindowPage();
  const usage = useUsage();
  useAccountUsagePolling();
  useCustomAgentUsagePolling();
  const layout = useLayout();
  const {
    activeServer,
    activeServerSupportsCapability,
    retryServerConnection,
    servers,
    serversLoaded,
    serversLoadFailed,
    refreshServers,
    refreshHostedServersAvailable,
    planDeletesAt,
  } = useServers();
  const { remoteDesktopWorkspaceVisible } = useRemoteDesktop();
  const agentDockPlacement = useAgentDockPlacement();
  const windowAgentDock = () => agentDockPlacement() === "window" && activeServer() !== undefined;
  const { agentSetupOpen, serverOnboardingOpen, activeAgent, agentList, agentListSettled } = useAgents();
  const { conversations, retryConversation } = useConversation();
  const activeConversation = () => conversations[activeAgent()?.id ?? ""];
  const { activeDirectMember } = useDirectMessages();
  const middlePane = createMemo(() => {
    if (chatWindow) return "agent";
    if (windowPage.page() === "tasks") return "tasks";
    if (agentSetupOpen()) return "agent-setup";
    if (channelOpen()) return "channel";
    if (activeDirectMember()) return "direct";
    return layout.sidebarView() === "routines" ? "routines" : "agent";
  });
  const agentChatOpen = () => middlePane() === "agent";
  if (chatWindow) {
    createEffect(
      () => activeAgent()?.name,
      (name) => {
        if (name) document.title = name;
      },
    );
    createEffect(
      () => agentListSettled() && !agentList().some((agent) => agent.id === platform.chatWindow?.agentId),
      (gone) => {
        if (gone) window.close();
      },
    );
  }
  const tasksSupported = () => activeServerSupportsCapability(AGENT_TASKS_CAPABILITY);
  createEffect(
    () => {
      const server = activeServer();
      return middlePane() === "tasks" && !tasksSupported() && !!server?.compatibility?.hostAppVersion;
    },
    (unsupported) => {
      if (unsupported) usage.closeUsage();
    },
  );
  createEffect(
    () => {
      const server = activeServer();
      if (usage.state.serverId === null || usage.state.view !== "library") return false;
      return !!server?.compatibility?.hostAppVersion && !serverHasStorage(server);
    },
    (unsupported) => {
      if (unsupported) usage.closeUsage();
    },
  );
  createEffect(
    () => {
      const server = activeServer();
      if (usage.state.serverId === null || usage.state.view !== "crm") return false;
      if (usage.crmEnabled() === false) return true;
      return !!server?.compatibility?.hostAppVersion && !serverCanAdminister(server, CRM_CAPABILITY);
    },
    (unsupported) => {
      if (unsupported) usage.closeUsage();
    },
  );
  const blockedRemoteServer = createMemo(() => {
    const server = activeServer();
    if (server?.kind !== "remote" || server.hostedSleep) return null;
    return server.state === "incompatible" ||
      serverPlanBlocks(server, planDeletesAt(server.id)) ||
      (server.issue && server.issue.code !== "network_unavailable")
      ? server
      : null;
  });
  const planScreenShown = () => serverPlanScreenShown(blockedRemoteServer(), planDeletesAt);
  const retryBlockedServer = (serverId: string) => {
    void refreshHostedServersAvailable();
    return retryServerConnection(serverId);
  };
  const activePeopleEnabled = createMemo(
    () => platform.peopleEnabled && activeServerSupportsCapability("direct-messages"),
  );

  const remote = () => activeServer()?.kind === "remote";
  createRemoteSyncMarks({
    "workspace-shell": () => remote() && serversLoaded(),
    "workspace-ready": () => remote() && scope.loaded(),
    "conversation-ready": () => remote() && activeConversation()?.loaded === true,
  });
  const offlineUpsell = createHostedUpsellOffline(
    () => remote() && activeServer()?.issue?.reference === "signal/host_unavailable",
  );
  const connectionFailure = () => {
    if (activeServer()?.hostRestart?.state === "restarting") return null;
    const issue = activeServer()?.issue;
    if (issue) return { message: sourceText(issue.message), reference: issue.reference ?? null };
    return scope.connection.failed ? scope.connection.failure : null;
  };
  const checkRemoteConnection = () => {
    const server = activeServer();
    if (server?.kind === "remote" && server.state === "online") void retryServerConnection(server.id);
  };
  const retryConversationLoad = () => {
    checkRemoteConnection();
    retryConversation();
  };
  const retry = () => {
    const server = activeServer();
    if (!serversLoaded()) {
      void refreshServers();
      return;
    }
    if (!server) return;
    if (server.state === "online") {
      checkRemoteConnection();
      scope.retry();
    } else void retryServerConnection(server.id);
  };
  if (!chatWindow)
    createServerConnectionToast(() => {
      const server = activeServer();
      return server?.kind === "remote"
        ? {
            id: server.id,
            name: server.name,
            ready: scope.loaded(),
            quiet: Boolean(server.hostedSleep || server.hostRestart?.state === "restarting" || blockedRemoteServer()),
          }
        : null;
    });

  const connectionShown = () =>
    (!serversLoaded() || !scope.connection.synced || (remote() && !scope.loaded())) && !blockedRemoteServer();
  const connectionPhase = () =>
    serverWorkspacePhase({
      hostedSleep: activeServer()?.hostedSleep,
      updating: activeServer()?.hostRestart?.state === "restarting",
      blocked: serversLoadFailed(),
      waiting: scope.connection.failed,
      loading: activeServer()?.state === "online",
      hasContent: scope.connection.synced,
    });
  const fullWindowLoading = () =>
    connectionShown() &&
    !scope.connection.synced &&
    (connectionPhase() === "loading" || connectionPhase() === "connecting") &&
    (!serversLoaded() ||
      activeServer()?.state === "online" ||
      activeServer()?.state === "connecting" ||
      (activeServer()?.state === "offline" && !activeServer()?.issue));
  const [loadingCover, setLoadingCover] = createSignal(false);
  const [coverOpen, setCoverOpen] = createSignal(false);
  const chatHeld = () => !!props.behindSplash?.() || (loadingCover() && !coverOpen());
  createEffect(
    () =>
      !platform.landingPreview &&
      !startsAfterRestart() &&
      fullWindowLoading() &&
      !loadingCover() &&
      !props.behindSplash?.(),
    (show) => {
      if (!show) return;
      setCoverOpen(false);
      setLoadingCover(true);
    },
  );
  createEffect(fullWindowLoading, (loading) => {
    if (!loading) finishRestartedStart();
  });
  createEffect(
    () => (fullWindowLoading() ? undefined : props.onStartupReady),
    (onStartupReady) => {
      onStartupReady?.();
    },
  );
  const connectionNotice = (cover = false, screen = true) => (
    <ServerConnectionNotice
      screen={screen}
      name={activeServer()?.name ?? ""}
      initial={cover || !scope.connection.synced}
      ready={cover ? !fullWindowLoading() : undefined}
      onExited={cover ? () => setLoadingCover(false) : undefined}
      onMountViews={cover ? () => setCoverOpen(true) : undefined}
      issue={activeServer()?.hostedIssue ?? null}
      start={activeServer()?.hostedStart ?? null}
      detail={connectionFailure()?.message ?? null}
      reference={connectionFailure()?.reference ?? null}
      updateVersion={activeServer()?.hostRestart?.version ?? null}
      phase={connectionPhase()}
      fullWindow={fullWindowLoading()}
      remainingSeconds={
        scope.connection.recovery.phase === "waiting" || scope.connection.recovery.phase === "cooldown"
          ? scope.connection.recovery.remainingSeconds
          : 0
      }
      busy={
        activeServer()?.state === "connecting" ||
        (activeServer()?.state === "online" && scope.connection.recovery.phase === "connecting")
      }
      onRetry={retry}
      onManage={() => settings.openAppSettings(null, "hosted-servers")}
      upsell={offlineUpsell()}
    />
  );

  createEffect(
    () => {
      const server = activeServer();
      return server?.kind === "remote" && agentListSettled()
        ? { id: server.id, empty: agentList().length === 0 }
        : null;
    },
    (seen) => {
      if (seen) noteServerAgents(seen.id, seen.empty);
    },
  );

  const remoteHosts = (): HostRestartView[] =>
    servers().flatMap((server) =>
      server.kind === "remote"
        ? [
            {
              id: server.id,
              name: server.name,
              online: server.id === activeServer()?.id ? scope.loaded() : server.state === "online",
              restart: server.hostRestart?.state ?? null,
              version: server.hostRestart?.version ?? null,
              ...(server.id === activeServer()?.id
                ? { firstRun: !agentListSettled() || agentList().length === 0 }
                : {}),
            },
          ]
        : [],
    );
  if (!chatWindow) {
    createHostRestartToasts(() => remoteHosts().filter((host) => !followsServerUpdate(host.id)));
    createRoutineTimezonePrompt(() => desktopRoutineZoneTargets(servers()));
  }

  return (
    <ConnectorsProvider>
      <WindowBackdrop />
      <div class="app-window">
        <WorkspacePageRail hidden={chatWindow || remoteDesktopWorkspaceVisible()} />
        <WorkspaceFrame
          class={chatWindow ? "app-frame-chat-window" : windowAgentDock() ? "app-frame-agent-dock" : undefined}
          compact={layout.leftPanelCompact()}
          initialLoading={!serversLoaded() || !scope.connection.synced}
          connection={
            <>
              <Show when={connectionShown() && !fullWindowLoading()}>{connectionNotice()}</Show>
              <Show when={scope.loaded() && agentChatOpen() && !serverOnboardingOpen()}>
                <ConversationLoadNotice
                  name={activeAgent()?.name ?? ""}
                  loading={!activeConversation()?.loaded && activeConversation()?.loading === true}
                  error={activeConversation()?.loadError ?? null}
                  onRetry={retryConversationLoad}
                />
              </Show>
              <Show when={scope.loaded() && scope.connection.panelsFailed}>
                <ServerPanelLoadNotice
                  busy={scope.connection.panelsLoading}
                  onRetry={() => {
                    checkRemoteConnection();
                    void scope.retryPanels();
                  }}
                />
              </Show>
            </>
          }
          hidden={remoteDesktopWorkspaceVisible()}
          blockedServer={blockedRemoteServer()}
          onRetryServer={retryBlockedServer}
          planDeletesAt={planDeletesAt}
          onRenewPlan={renewServerPlan}
          windowPage={windowPage.page()}
          left={
            <Show when={!chatWindow}>
              <WorkspaceServerRail />
              <Show when={!planScreenShown()}>
                <WorkspaceSidebar peopleEnabled={activePeopleEnabled()} />
              </Show>
            </Show>
          }
          page={<WindowPageView />}
          after={
            <>
              <WorkspaceOverlays account={props.account} />
              <Show when={!chatWindow}>
                <ServerUpdateDialogHost hosts={remoteHosts()} />
                <AgentDockHost />
              </Show>
            </>
          }
        >
          <Show when={middlePane() === "tasks" && tasksSupported() ? usage.state.serverId : null}>
            {(serverId) => (
              <TasksPanel
                serverId={serverId()}
                hostName={servers().find((server) => server.id === serverId())?.name ?? t("app.page.serverFallback")}
                onBack={usage.closeUsage}
              />
            )}
          </Show>
          <Show when={serverOnboardingOpen() && middlePane() !== "tasks"}>
            <WorkspaceServerOnboarding />
          </Show>
          <Show when={middlePane() === "agent-setup" && !serverOnboardingOpen()}>
            <WorkspaceAgentSetup />
          </Show>
          <Show when={activePeopleEnabled() && middlePane() === "direct" && activeDirectMember()?.id} keyed>
            <Show when={activeDirectMember()}>{(member) => <WorkspaceDirectConversation member={member()} />}</Show>
          </Show>
          <Show when={agentChatOpen() && !chatHeld()}>
            <WorkspaceConversation account={props.account} />
          </Show>
          <Show when={middlePane() === "routines"}>
            <WorkspaceRoutineFlows />
          </Show>
          <Show when={middlePane() === "channel"}>
            <WorkspaceChannelConversation account={props.account} />
          </Show>
        </WorkspaceFrame>
        <Show when={loadingCover()}>{connectionNotice(true)}</Show>
        <Show when={fullWindowLoading() && !loadingCover() && props.behindSplash?.()}>
          {connectionNotice(true, false)}
        </Show>
      </div>
    </ConnectorsProvider>
  );
}
