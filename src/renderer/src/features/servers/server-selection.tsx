import type { AddedAgent, AgentProviderId, NotificationOpenedEvent, ServerSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { useSettings } from "../settings/settings-context";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { activeServerId, serversPort } from "./servers-port";

/**
 * Switching the active server, and the two ways a new one arrives: joining from
 * an invite, and opening an agent installed from the marketplace.
 *
 * `selectServer` used to be the largest leaf in the tree because it tore down
 * and refilled every per-server domain by hand. It no longer touches any of
 * them: `setServers` changes the active id, the keyed boundary in
 * `app-providers.tsx` disposes the scope, and the fresh scope loads itself. What
 * is left is the part that genuinely spans the two - the compatibility retry,
 * the analytics, and the authoritative-server recovery when main disagrees with
 * what was asked for.
 *
 * It still lives inside the scope, below the domains it guards on, and that is
 * safe for a reason worth naming: every line after `setServers` runs in a
 * disposed owner, and none of them touch a scoped signal. The browser
 * suspension and the pending agent selection are read from
 * `server-switch.tsx`, which sits above the boundary precisely so a value
 * written before the switch survives it.
 */
const ServerSelection = createSimpleContext({
  name: "Server selection",
  init: () => {
    const { servers, setServers, beginServerSelection } = useServers();
    const { pendingInviteUrl, setPendingInviteUrl, saveSetup } = useSetup();
    const { setSkillsMarketplaceOpen } = useSettings();
    const { disconnectRemoteDesktopWorkspace } = useRemoteDesktop();
    const { setBrowserVisibilitySuspended, setPendingAgentSelection } = useServerSwitch();
    const { agentSetupOpen, creatingAgent } = useAgents();
    const { stopComposerTyping } = useConversationController();
    const { setDirectTyping } = useDirectMessages();

    async function selectServer(
      serverId: string,
      trackSelection = true,
      recoverAuthoritativeServer = true,
    ): Promise<boolean> {
      if (agentSetupOpen() && creatingAgent()) return false;
      const selectionIsCurrent = beginServerSelection();
      const analytics = desktopAnalytics.scope();
      const previousServerId = servers().find((server) => server.active)?.id;
      const switchingServers = Boolean(previousServerId && previousServerId !== serverId);
      if (switchingServers) setBrowserVisibilitySuspended(true);
      try {
        if (switchingServers) {
          // Both of these have to happen before `servers.select()`, not when the
          // scope is disposed. Main moves its active server the moment `select`
          // resolves, while the keyed boundary tears the scope down only after
          // `setServers`, so a typing indicator released on the way out would be
          // addressed to the server being entered and the one being left would
          // keep showing it until its own timeout.
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
        setServers(nextServers);
        return true;
      } finally {
        if (selectionIsCurrent()) setBrowserVisibilitySuspended(false);
      }
    }

    /**
     * Never rejects: the agent is installed by now, and a failure to open it must not read as a failed
     * install, or the user would add it a second time. Both the marketplace and a shared-agent link
     * call this after their install. `serverId` is the joined server whose host added the agent.
     */
    async function openInstalledMarketplaceAgent(agent: AddedAgent, serverId = "local"): Promise<void> {
      try {
        if (!(await selectServer(serverId, false))) return;
      } catch {
        toast.error(`Could not open ${agent.name}. Find it in the sidebar.`);
        return;
      }
      // Published rather than called: if this was a switch, the navigation
      // domain that owns `selectAgent` has already been replaced by the one in
      // the new scope, and that is the one that has to run it.
      setPendingAgentSelection(agent.id);
      setSkillsMarketplaceOpen(false);
    }

    async function openNotifiedAgent(event: NotificationOpenedEvent): Promise<void> {
      const onServer = servers().find((server) => server.active)?.id === event.serverId;
      if (!onServer && !(await selectServer(event.serverId, false))) return;
      // Published for the same reason as the marketplace agent above.
      setPendingAgentSelection(event.agentId);
    }

    onSettled(() =>
      serversPort().notifications.onOpened((event) => {
        void openNotifiedAgent(event).catch(() => undefined);
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

    async function joinRemoteDuringSetup(input: { inviteUrl: string }, provider: AgentProviderId): Promise<void> {
      await joinServer(input);
      await saveSetup(provider);
    }

    return {
      selectServer,
      joinServer,
      joinRemoteDuringSetup,
      openInstalledMarketplaceAgent,
    };
  },
});

export const ServerSelectionProvider = ServerSelection.provider;
export const useServerSelection = ServerSelection.use;
