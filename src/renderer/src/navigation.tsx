import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { toAgentMessage } from "./app-message-projection";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { useChannels } from "./features/channels/channels-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { useServers } from "./features/servers/servers-context";
import { usePresence } from "./features/team/team-context";
import { useUsage } from "./features/usage/usage-context";
import { usePlatform } from "./platform";
import { createScopeGuard } from "./scope-lifetime";
import { createSimpleContext } from "./simple-context";

/**
 * Cross-domain open/select commands (agent chat, direct conversation, message focus, global
 * search). Leaf context below agents/conversation/direct-messages so one call can write to
 * all three without cycles (`noImportCycles` is an error). See docs/ARCHITECTURE.md.
 * Ungated - see `app-providers.tsx`.
 */
const Navigation = createSimpleContext({
  name: "Navigation",
  init: () => {
    const { peopleEnabled } = usePlatform();
    const { activeServerId } = useServers();
    const { currentTeamMember, directPeople } = usePresence();
    const {
      activeAgentId,
      setActiveAgentId,
      agentSetupOpen,
      setAgentSetupOpen,
      setAgentSetupError,
      creatingAgent,
      setSettingsRequest,
      setExplicitlyOpenedAgentChatId,
      appendUiError,
    } = useAgents();
    const { setDirectTyping, clearDirectSelection, openDirectConversation } = useDirectMessages();
    const channels = useChannels();
    const { dismissUsage } = useUsage();
    const scopeIsCurrent = createScopeGuard();
    const {
      pruneInactiveAgentHistory,
      clearRecentReply,
      requestConversationRead,
      loadAgentMessagePage,
      markAgentMessagesRead,
    } = useConversation();

    const [globalSearchOpen, setGlobalSearchOpen] = createSignal(false);
    const [messageFocusRequest, setMessageFocusRequest] = createSignal<{
      agentId: string;
      messageId: string;
      nonce: number;
    } | null>(null);

    function selectAgent(agentId: string) {
      if (agentSetupOpen() && creatingAgent()) return;
      // The rail and the sidebar sit outside the markup the report covers, so a
      // conversation is one click away while the report hides where it opens. Opening
      // one that stays hidden also reads it: `requestConversationRead` below is the
      // explicit read, and a search result runs `openAgentMessage`, which marks every
      // message through the match. Both would be messages nobody saw.
      dismissUsage();
      // An open channel covers the workspace the same way the report does, so it has to leave here
      // rather than in each caller: Edit agent and a global-search result open a chat that would
      // otherwise stay hidden under it.
      channels.close();
      const previousAgentId = activeAgentId();
      if (previousAgentId && previousAgentId !== agentId) pruneInactiveAgentHistory(previousAgentId);
      setAgentSetupOpen(false);
      setAgentSetupError(null);
      setDirectTyping(false);
      clearDirectSelection();
      clearRecentReply(agentId);
      setExplicitlyOpenedAgentChatId(agentId);
      setActiveAgentId(agentId);
      requestConversationRead(agentId, true);
    }

    async function selectDirectMember(memberId: string): Promise<void> {
      if (agentSetupOpen() && creatingAgent()) return;
      if (!peopleEnabled || !currentTeamMember() || !directPeople().some((member) => member.id === memberId)) return;
      // Past the guards, so a call that opens nothing leaves the report or the channel alone.
      dismissUsage();
      channels.close();
      const previousAgentId = activeAgentId();
      if (previousAgentId) pruneInactiveAgentHistory(previousAgentId);
      setExplicitlyOpenedAgentChatId(null);
      setAgentSetupOpen(false);
      setAgentSetupError(null);
      setSettingsRequest(null);
      await openDirectConversation(memberId);
    }

    function setGlobalSearchVisibility(open: boolean): void {
      setGlobalSearchOpen(open);
    }

    async function searchGlobalMessages(query: string): Promise<Array<{ agentId: string; message: AgentMessage }>> {
      const analytics = desktopAnalytics.scope();
      try {
        const page = await appPort().agent.searchConversationMessages({ query, limit: 100 });
        analytics.track("search_action", { scope: "global", result: "succeeded", result_count: page.total });
        return page.results.map((result) => ({
          agentId: result.agentId,
          message: toAgentMessage(result.message, result.agentId),
        }));
      } catch (error) {
        analytics.track("search_action", { scope: "global", result: "failed", failure_code: "search_failed" });
        throw error;
      }
    }

    function selectGlobalSearchMessage(agentId: string, messageId: string): void {
      selectAgent(agentId);
      void openAgentMessage(agentId, messageId);
    }

    async function openAgentMessage(agentId: string, messageId: string): Promise<void> {
      const serverId = activeServerId();
      await Promise.resolve();
      if (!scopeIsCurrent()) return;
      try {
        const page = await loadAgentMessagePage(agentId, messageId);
        if (!page) return;
        setMessageFocusRequest({ agentId, messageId, nonce: Date.now() });
        try {
          let readBoundary = page.messages.at(-1)?.id ?? messageId;
          try {
            if (!scopeIsCurrent()) return;
            const latestPage = await appPort().agent.readConversationPage({
              agentId,
              anchor: { type: "latest" },
              limit: 1,
            });
            if (!scopeIsCurrent()) return;
            readBoundary = latestPage.messages.at(-1)?.id ?? readBoundary;
          } catch {
            // The focused page still gives us a safe read boundary when the latest-page refresh fails.
          }
          await markAgentMessagesRead(agentId, readBoundary, serverId);
        } catch (error) {
          appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
        }
      } catch (error) {
        appendUiError(agentId, error, currentText().t("app.errorStatus.messageLoad"), serverId);
      }
    }

    return {
      selectAgent,
      selectDirectMember,
      openAgentMessage,
      messageFocusRequest,
      globalSearchOpen,
      setGlobalSearchVisibility,
      searchGlobalMessages,
      selectGlobalSearchMessage,
    };
  },
});

export const NavigationProvider = Navigation.provider;
export const useNavigation = Navigation.use;
