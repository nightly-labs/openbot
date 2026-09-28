import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { createMemo, Show } from "solid-js";
import { WorkspaceAccountDock } from "./features/account/WorkspaceAccountDock";
import { useAgents } from "./features/agents/agents-context";
import { WorkspaceAgentSetup } from "./features/agents/WorkspaceAgentSetup";
import { ChannelCreateDialog } from "./features/channels/ChannelCreateDialog";
import { useChannels } from "./features/channels/channels-context";
import { WorkspaceChannelConversation } from "./features/channels/WorkspaceChannelConversation";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { WorkspaceConversation } from "./features/conversation/WorkspaceConversation";
import { WorkspaceDirectConversation } from "./features/conversation/WorkspaceDirectConversation";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { useServers } from "./features/servers/servers-context";
import { WorkspaceServerRail } from "./features/servers/WorkspaceServerRail";
import { WorkspaceSidebar } from "./features/sidebar/WorkspaceSidebar";
import { AgentUsagePanel } from "./features/usage/AgentUsagePanel";
import { useUsage } from "./features/usage/usage-context";
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
 * server wins over everything, then the Agent form, then a channel, then a
 * person, then a Agent. The usage panel sits outside that group and inerts it.
 */
export function WorkspaceShell(props: { account: () => CentralAuthUser }) {
  const platform = usePlatform();
  const channels = useChannels();
  const channelOpen = () => channels.state.selectedId !== null;
  const usage = useUsage();
  const layout = useLayout();
  const { activeServer, activeServerSupportsCapability, retryServerConnection, servers } = useServers();
  const { remoteDesktopWorkspaceVisible } = useRemoteDesktop();
  const { agentSetupOpen } = useAgents();
  const { activeDirectMember } = useDirectMessages();

  const blockedRemoteServer = createMemo(() => {
    const server = activeServer();
    if (server?.kind !== "remote") return null;
    return server.state === "incompatible" || server.issue != null ? server : null;
  });
  const activePeopleEnabled = createMemo(
    () => platform.peopleEnabled && activeServerSupportsCapability("direct-messages"),
  );

  return (
    <WorkspaceFrame
      compact={layout.leftPanelCompact()}
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
            <AgentUsagePanel
              serverId={serverId()}
              hostName={servers().find((server) => server.id === serverId())?.name ?? "Host"}
              agentId={usage.state.agentId}
              onBack={usage.closeUsage}
            />
          )}
        </Show>
      }
      after={
        <>
          <WorkspaceOverlays account={props.account} />
          <Show when={channels.state.editing === "create"}>
            <ChannelCreateDialog />
          </Show>
        </>
      }
    >
      <Show when={agentSetupOpen()}>
        <WorkspaceAgentSetup />
      </Show>
      <Show when={activePeopleEnabled() && !agentSetupOpen() && !channelOpen() && activeDirectMember()} keyed>
        {(member) => <WorkspaceDirectConversation member={member} />}
      </Show>
      <Show when={!agentSetupOpen() && !channelOpen() && !activeDirectMember()}>
        <WorkspaceConversation account={props.account} />
      </Show>
      <Show when={!agentSetupOpen() && channelOpen()}>
        <WorkspaceChannelConversation />
      </Show>
    </WorkspaceFrame>
  );
}
