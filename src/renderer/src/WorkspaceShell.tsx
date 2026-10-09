import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { ServerConnectionNotice, ServerPanelLoadNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import { createMemo, Loading, Show } from "solid-js";
import { WorkspaceAccountDock } from "./features/account/WorkspaceAccountDock";
import { useAgents } from "./features/agents/agents-context";
import { WorkspaceAgentSetup } from "./features/agents/WorkspaceAgentSetup";
import { useChannels } from "./features/channels/channels-context";
import { WorkspaceChannelConversation } from "./features/channels/WorkspaceChannelConversation";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { WorkspaceConversation } from "./features/conversation/WorkspaceConversation";
import { WorkspaceDirectConversation } from "./features/conversation/WorkspaceDirectConversation";
import { WorkspaceServerOnboarding } from "./features/onboarding/WorkspaceServerOnboarding";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { WorkspaceRoutineFlows } from "./features/routine-flows/WorkspaceRoutineFlows";
import { SchedulePanel } from "./features/schedule/SchedulePanel";
import { createServerConnectionToast } from "./features/servers/server-connection-toast";
import { useServerScope } from "./features/servers/server-scope";
import { useServers } from "./features/servers/servers-context";
import { WorkspaceServerRail } from "./features/servers/WorkspaceServerRail";
import { useSettings } from "./features/settings/settings-context";
import { WorkspaceSidebar } from "./features/sidebar/WorkspaceSidebar";
import { createHostRestartToasts } from "./features/updates/host-restart-toast";
import { useUsage } from "./features/usage/usage-context";
import { useLayout } from "./layout";
import { AgentUsagePanel } from "./lazy-views";
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
 * server wins over everything, then a joined server's provider step, then the
 * Agent form, then a channel, then a
 * person, then a Agent: its chat, or on the Routines view its routine canvas. The usage panel sits outside that group and inerts it.
 */
export function WorkspaceShell(props: { account: () => CentralAuthUser }) {
  const platform = usePlatform();
  const scope = useServerScope();
  const settings = useSettings();
  const channels = useChannels();
  const channelOpen = () => channels.state.selectedId !== null;
  const usage = useUsage();
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
  const { agentSetupOpen, serverOnboardingOpen, activeAgent } = useAgents();
  const { conversations, retryConversation } = useConversation();
  const activeConversation = () => conversations[activeAgent()?.id ?? ""];
  const { activeDirectMember } = useDirectMessages();

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
  createServerConnectionToast(() => {
    const server = activeServer();
    return server?.kind === "remote"
      ? {
          id: server.id,
          name: server.name,
          ready: scope.loaded(),
          quiet: Boolean(server.hostedSleep || server.hostRestart || blockedRemoteServer()),
        }
      : null;
  });

  createHostRestartToasts(() =>
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
    ),
  );

  return (
    <WorkspaceFrame
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
              issue={activeServer()?.hostedIssue}
              phase={
                activeServer()?.hostedSleep ??
                (serversLoadFailed()
                  ? "blocked"
                  : scope.connection.failed
                    ? "waiting"
                    : activeServer()?.state === "online"
                      ? "loading"
                      : scope.connection.hasContent
                        ? "reconnecting"
                        : "connecting")
              }
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
            />
          </Show>
          <Show
            when={
              scope.loaded() &&
              !channelOpen() &&
              !activeDirectMember() &&
              (activeConversation()?.loadError || (!activeConversation()?.loaded && activeConversation()?.loading))
            }
          >
            <ServerConnectionNotice
              name={activeAgent()?.name ?? ""}
              phase={activeConversation()?.loadError ? "blocked" : "loading"}
              initial={false}
              detail={activeConversation()?.loadError ?? undefined}
              busy={activeConversation()?.loading}
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
      usageOpen={!!usage.state.serverId}
      left={
        <>
          <WorkspaceServerRail />
          <WorkspaceSidebar peopleEnabled={activePeopleEnabled()} />
          <WorkspaceAccountDock account={props.account} />
        </>
      }
      usage={
        <Show when={usage.state.serverId}>
          {(serverId) => (
            <Show
              when={usage.state.view === "schedule"}
              fallback={
                <Loading>
                  <AgentUsagePanel
                    serverId={serverId()}
                    hostName={servers().find((server) => server.id === serverId())?.name ?? "Host"}
                    agentId={usage.state.agentId}
                    onBack={usage.closeUsage}
                  />
                </Loading>
              }
            >
              <SchedulePanel
                serverId={serverId()}
                hostName={servers().find((server) => server.id === serverId())?.name ?? "Host"}
                onBack={usage.closeUsage}
              />
            </Show>
          )}
        </Show>
      }
      after={<WorkspaceOverlays account={props.account} />}
    >
      <Show when={serverOnboardingOpen()}>
        <WorkspaceServerOnboarding />
      </Show>
      <Show when={agentSetupOpen() && !serverOnboardingOpen()}>
        <WorkspaceAgentSetup />
      </Show>
      <Show when={activePeopleEnabled() && !agentSetupOpen() && !channelOpen() && activeDirectMember()} keyed>
        {(member) => <WorkspaceDirectConversation member={member} />}
      </Show>
      <Show when={!agentSetupOpen() && !channelOpen() && !activeDirectMember() && layout.sidebarView() !== "routines"}>
        <WorkspaceConversation account={props.account} />
      </Show>
      <Show when={!agentSetupOpen() && !channelOpen() && !activeDirectMember() && layout.sidebarView() === "routines"}>
        <WorkspaceRoutineFlows />
      </Show>
      <Show when={!agentSetupOpen() && channelOpen()}>
        <WorkspaceChannelConversation />
      </Show>
    </WorkspaceFrame>
  );
}
