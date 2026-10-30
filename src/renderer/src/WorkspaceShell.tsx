import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  ConversationLoadNotice,
  ServerConnectionNotice,
  ServerPanelLoadNotice,
  serverWorkspacePhase,
} from "@openbot/ui/features/servers/ServerConnectionNotice";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, Show } from "solid-js";
import { useAccountUsagePolling } from "./features/account/account-usage-polling";
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
import { WorkspaceServerOnboarding } from "./features/onboarding/WorkspaceServerOnboarding";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { WorkspaceRoutineFlows } from "./features/routine-flows/WorkspaceRoutineFlows";
import { createRoutineTimezonePrompt, desktopRoutineZoneTargets } from "./features/schedule/routine-timezone-prompt";
import { createHostedUpsellOffline } from "./features/servers/hosted-server-upsell-controller";
import { createServerConnectionToast } from "./features/servers/server-connection-toast";
import { useServerScope } from "./features/servers/server-scope";
import { followsServerUpdate, ServerUpdateDialogHost } from "./features/servers/server-update-flow";
import { useServers } from "./features/servers/servers-context";
import { WorkspaceServerRail } from "./features/servers/WorkspaceServerRail";
import { useSettings } from "./features/settings/settings-context";
import { WorkspaceSidebar } from "./features/sidebar/WorkspaceSidebar";
import { TasksPanel } from "./features/tasks/TasksPanel";
import { createHostRestartToasts, type HostRestartView } from "./features/updates/host-restart-toast";
import { useUsage } from "./features/usage/usage-context";
import { WindowPageView } from "./features/window/WindowPageView";
import { WorkspacePageRail } from "./features/window/WorkspacePageRail";
import { useWindowPage } from "./features/window/window-page-context";
import { useLayout } from "./layout";
import { usePlatform } from "./platform";
import { WorkspaceFrame } from "./WorkspaceFrame";
import { WorkspaceOverlays } from "./WorkspaceOverlays";

/**
 * The desktop application frame, and nothing else: which pane occupies the
 * middle and whether the whole frame is hidden behind the remote-desktop
 * workspace. `WorkspaceFrame` draws the grid, which the web client shares.
 *
 * Each pane below reads the domains it needs through its own `use*()`, so this
 * component reads only what the frame itself decides with. That is the point of
 * the split - the shell used to call every context in the renderer because it
 * assembled every pane's props, and a change to any one pane went through here.
 * Two derived values stay because they choose *which* pane renders, and one of
 * them is passed on rather than derived twice.
 *
 * The order of the children is the paint order the stylesheet expects, and the
 * middle-pane `<Show>`s are mutually exclusive by construction: a blocked remote
 * server wins over everything, then the Tasks page of the rail, then a joined server's provider step,
 * then the Agent form, then a channel, then a person, then a Agent: its chat, or on the Routines view
 * its routine canvas. The Tasks page hides the agent list until the user shows it. A row of the list
 * closes the page, as each row calls `showAgents`. The other pages of the rail - schedule, usage or settings - sit outside that
 * group and inert it.
 */
export function WorkspaceShell(props: { account: () => CentralAuthUser }) {
  const platform = usePlatform();
  /** A window that main opened for one chat shows that chat alone, with no rail and no sidebar. */
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
  } = useServers();
  const { remoteDesktopWorkspaceVisible } = useRemoteDesktop();
  const { agentSetupOpen, serverOnboardingOpen, activeAgent, agentList, agentListSettled } = useAgents();
  const { conversations, retryConversation } = useConversation();
  const activeConversation = () => conversations[activeAgent()?.id ?? ""];
  const { activeDirectMember } = useDirectMessages();
  /**
   * The pane in the middle. The Tasks page wins, as it covered the panes when it was a page over them.
   * Then the Agent form, then a channel, then a person, then the Agent or its routines.
   */
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
    // The title names the chat. The window closes when its agent is gone, so it never shows another.
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
  /**
   * The Tasks page follows a server switch. An older joined server has no task routes and no Tasks button,
   * so the page closes when the server answers the compatibility check without them.
   */
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
  /** The list stays while a connection screen covers the page: the screen does not span the sidebar. */
  const tasksAgentsHidden = () =>
    middlePane() === "tasks" &&
    !windowPage.tasksAgentsOpen() &&
    scope.loaded() &&
    !scope.connection.panelsFailed &&
    !blockedRemoteServer();

  const blockedRemoteServer = createMemo(() => {
    const server = activeServer();
    // A hosted server that sleeps or wakes keeps the workspace on screen. The next input wakes it.
    if (server?.kind !== "remote" || server.hostedSleep) return null;
    return server.state === "incompatible" || (server.issue && server.issue.code !== "network_unavailable")
      ? server
      : null;
  });
  const activePeopleEnabled = createMemo(
    () => platform.peopleEnabled && activeServerSupportsCapability("direct-messages"),
  );

  const remote = () => activeServer()?.kind === "remote";
  // Only Signal knows that the computer is off. A remote server is also "offline" before its first connection.
  const offlineUpsell = createHostedUpsellOffline(
    () => remote() && activeServer()?.issue?.reference === "signal/host_unavailable",
  );
  // The transport failure comes first: a workspace load fails when the transport fails. Signal and
  // the host send English source text, so show the issue in the reader's language. The scope failure
  // is already translated.
  const connectionFailure = () => {
    // A host that restarts into an update drops the connection on purpose. That error is not news.
    if (activeServer()?.hostRestart?.state === "restarting") return null;
    const issue = activeServer()?.issue;
    if (issue) return { message: sourceText(issue.message), reference: issue.reference ?? null };
    return scope.connection.failed ? scope.connection.failure : null;
  };
  const retry = () => {
    const server = activeServer();
    if (!serversLoaded()) {
      void refreshServers();
      return;
    }
    if (!server) return;
    if (server.state === "online") scope.retry();
    else void retryServerConnection(server.id);
  };
  // The main window shows the toasts and prompts of the servers once.
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
            },
          ]
        : [],
    );
  if (!chatWindow) {
    // The update dialog explains the restart of the update that it follows.
    createHostRestartToasts(() => remoteHosts().filter((host) => !followsServerUpdate(host.id)));
    createRoutineTimezonePrompt(() => desktopRoutineZoneTargets(servers()));
  }

  return (
    // The overlays and the chat cards show the same connectors.
    <ConnectorsProvider>
      {/* The page rail sits at the left of the frame. The frame is the card of the page that the rail selects. */}
      <div class="app-window">
        <WorkspacePageRail hidden={chatWindow || remoteDesktopWorkspaceVisible()} />
        <WorkspaceFrame
          class={chatWindow ? "app-frame-chat-window" : undefined}
          compact={layout.leftPanelCompact()}
          initialLoading={!serversLoaded() || !scope.connection.hasContent}
          connection={
            <>
              <Show
                when={
                  (!serversLoaded() || !scope.connection.hasContent || (remote() && !scope.loaded())) &&
                  !blockedRemoteServer()
                }
              >
                <ServerConnectionNotice
                  name={activeServer()?.name ?? ""}
                  initial={!scope.connection.hasContent}
                  issue={activeServer()?.hostedIssue ?? null}
                  start={activeServer()?.hostedStart ?? null}
                  detail={connectionFailure()?.message ?? null}
                  reference={connectionFailure()?.reference ?? null}
                  updateVersion={activeServer()?.hostRestart?.version ?? null}
                  phase={serverWorkspacePhase({
                    hostedSleep: activeServer()?.hostedSleep,
                    updating: activeServer()?.hostRestart?.state === "restarting",
                    blocked: serversLoadFailed(),
                    waiting: scope.connection.failed,
                    loading: activeServer()?.state === "online",
                    hasContent: scope.connection.hasContent,
                  })}
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
              </Show>
              <Show when={scope.loaded() && agentChatOpen() && !serverOnboardingOpen()}>
                <ConversationLoadNotice
                  name={activeAgent()?.name ?? ""}
                  loading={!activeConversation()?.loaded && activeConversation()?.loading === true}
                  error={activeConversation()?.loadError ?? null}
                  onRetry={retryConversation}
                />
              </Show>
              <Show when={scope.loaded() && scope.connection.panelsFailed}>
                <ServerPanelLoadNotice busy={scope.connection.panelsLoading} onRetry={() => void scope.retryPanels()} />
              </Show>
            </>
          }
          hidden={remoteDesktopWorkspaceVisible()}
          blockedServer={blockedRemoteServer()}
          onRetryServer={retryServerConnection}
          windowPage={windowPage.page()}
          sidebarHidden={tasksAgentsHidden()}
          left={
            <Show when={!chatWindow}>
              <WorkspaceServerRail />
              <WorkspaceSidebar peopleEnabled={activePeopleEnabled()} />
            </Show>
          }
          page={<WindowPageView />}
          after={
            <>
              <WorkspaceOverlays account={props.account} />
              <Show when={!chatWindow}>
                <ServerUpdateDialogHost hosts={remoteHosts()} />
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
                agentsOpen={!tasksAgentsHidden()}
                onToggleAgents={() => windowPage.setTasksAgentsOpen(tasksAgentsHidden())}
              />
            )}
          </Show>
          <Show when={serverOnboardingOpen() && middlePane() !== "tasks"}>
            <WorkspaceServerOnboarding />
          </Show>
          <Show when={middlePane() === "agent-setup" && !serverOnboardingOpen()}>
            <WorkspaceAgentSetup />
          </Show>
          {/* Keyed by id: each presence snapshot is a new member object, and remounting would clear the draft. */}
          <Show when={activePeopleEnabled() && middlePane() === "direct" && activeDirectMember()?.id} keyed>
            <Show when={activeDirectMember()}>{(member) => <WorkspaceDirectConversation member={member()} />}</Show>
          </Show>
          <Show when={agentChatOpen()}>
            <WorkspaceConversation account={props.account} />
          </Show>
          <Show when={middlePane() === "routines"}>
            <WorkspaceRoutineFlows />
          </Show>
          <Show when={middlePane() === "channel"}>
            <WorkspaceChannelConversation account={props.account} />
          </Show>
        </WorkspaceFrame>
      </div>
    </ConnectorsProvider>
  );
}
