import type {
  AddedAgent,
  AgentProviderId,
  NotificationOpenedEvent,
  ServerSummary,
  WorkflowNotificationOpenedEvent,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { useSettings } from "../settings/settings-context";
import { useWindowPage } from "../window/window-page-context";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { activeServerId, serversPort } from "./servers-port";

const ServerSelection = createSimpleContext({
  name: "Server selection",
  init: () => {
    const { servers, setServers, beginServerSelection } = useServers();
    const { pendingInviteUrl, setPendingInviteUrl, saveSetup } = useSetup();
    const { setSkillsMarketplaceOpen } = useSettings();
    const { disconnectRemoteDesktopWorkspace } = useRemoteDesktop();
    const {
      setBrowserVisibilitySuspended,
      setPendingAgentSelection,
      setPendingChannelSelection,
      setPendingThreadSelection,
      setPreviousServerId,
    } = useServerSwitch();
    const { agentSetupOpen, creatingAgent } = useAgents();
    const { stopComposerTyping } = useConversationController();
    const { setDirectTyping } = useDirectMessages();
    const { chatWindow } = usePlatform();
    const windowPage = useWindowPage();

    async function selectServer(
      serverId: string,
      trackSelection = true,
      recoverAuthoritativeServer = true,
    ): Promise<boolean> {
      if (agentSetupOpen() && creatingAgent()) return false;
      if (chatWindow) return false;
      const selectionIsCurrent = beginServerSelection();
      const analytics = desktopAnalytics.scope();
      const previousServerId = servers().find((server) => server.active)?.id;
      const switchingServers = Boolean(previousServerId && previousServerId !== serverId);
      if (switchingServers) setBrowserVisibilitySuspended(true);
      try {
        if (switchingServers) {
          stopComposerTyping();
          setDirectTyping(false);
          await disconnectRemoteDesktopWorkspace(false);
          if (!selectionIsCurrent()) return false;
          await serversPort()
            .browser.setVisible({ visible: false })
            .catch(() => undefined);
          if (!selectionIsCurrent()) return false;
        }
        let nextServers: ServerSummary[];
        try {
          nextServers = await serversPort().servers.select(serverId);
          if (!selectionIsCurrent()) return false;
          const authoritativeServerId = nextServers.find((server) => server.active)?.id;
          if (authoritativeServerId !== serverId) {
            if (authoritativeServerId) await selectServer(authoritativeServerId, false, false);
            return false;
          }
          if (trackSelection) {
            analytics.track("team_action", {
              action: "server_selected",
              result: "succeeded",
              server_kind: nextServers.find((server) => server.active)?.kind ?? "unknown",
            });
          }
        } catch (error) {
          if (!selectionIsCurrent()) return false;
          if (trackSelection) {
            analytics.track("team_action", {
              action: "server_selected",
              result: "failed",
              failure_code: "server_select_failed",
            });
          }
          if (recoverAuthoritativeServer) {
            const authoritativeServers = await serversPort()
              .servers.list()
              .catch(() => null);
            if (!selectionIsCurrent()) return false;
            const authoritativeServerId = authoritativeServers?.find((server) => server.active)?.id;
            if (authoritativeServerId && authoritativeServerId !== previousServerId) {
              await selectServer(authoritativeServerId, false, false);
            }
          }
          throw error;
        }
        if (switchingServers && previousServerId) setPreviousServerId(previousServerId);
        setServers(nextServers);
        return true;
      } finally {
        if (selectionIsCurrent()) setBrowserVisibilitySuspended(false);
      }
    }

    async function openInstalledMarketplaceAgent(agent: AddedAgent, serverId = "local"): Promise<void> {
      try {
        if (!(await selectServer(serverId, false))) return;
      } catch {
        actionToast.error(currentText().t("server.select.openAgentFailed", { name: agent.name }), {
          report: { operation: "team", source: "action", cause_code: "unknown" },
        });
        return;
      }
      setPendingAgentSelection(agent.id);
      setSkillsMarketplaceOpen(false);
    }

    async function openNotifiedAgent(event: NotificationOpenedEvent): Promise<void> {
      const onServer = servers().find((server) => server.active)?.id === event.serverId;
      if (!onServer && !(await selectServer(event.serverId, false))) return;
      if (event.channelId) {
        setPendingChannelSelection(event.channelId);
        return;
      }
      if (event.threadId) setPendingThreadSelection({ agentId: event.agentId, threadId: event.threadId });
      setPendingAgentSelection(event.agentId);
    }

    onSettled(() =>
      serversPort().notifications.onOpened((event) => {
        void openNotifiedAgent(event).catch(() => undefined);
      }),
    );

    async function openNotifiedWorkflow(event: WorkflowNotificationOpenedEvent): Promise<void> {
      const onServer = servers().find((server) => server.active)?.id === event.serverId;
      if (!onServer && !(await selectServer(event.serverId, false))) return;
      windowPage.openWorkflows(null, event);
    }

    onSettled(() =>
      serversPort().notifications.onWorkflowOpened((event) => {
        void openNotifiedWorkflow(event).catch(() => undefined);
      }),
    );

    async function joinServer(input: { inviteUrl: string }): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const entryPoint = pendingInviteUrl() ? "invite_deep_link" : "in_app";
      try {
        await serversPort().servers.join(input);
        setPendingInviteUrl("");
        await selectServer(await activeServerId(), false);
        analytics.track("team_action", { action: "server_joined", result: "succeeded", entry_point: entryPoint });
      } catch (error) {
        analytics.track("team_action", {
          action: "server_joined",
          result: "failed",
          entry_point: entryPoint,
          failure_code: "join_failed",
        });
        throw error;
      }
    }

    async function createLocalServer(name: string): Promise<void> {
      const server = await serversPort().localServers.create(name);
      await selectServer(server.id, false);
    }

    async function joinRemoteDuringSetup(input: { inviteUrl: string }, provider: AgentProviderId): Promise<void> {
      await joinServer(input);
      await saveSetup(provider);
    }

    return {
      selectServer,
      joinServer,
      createLocalServer,
      joinRemoteDuringSetup,
      openInstalledMarketplaceAgent,
    };
  },
});

export const ServerSelectionProvider = ServerSelection.provider;
export const useServerSelection = ServerSelection.use;
