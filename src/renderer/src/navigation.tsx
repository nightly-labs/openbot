import { createSignal } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { toAgentMessage } from "./app-message-projection";
import type { AgentMessage } from "./data";
import { useAgents } from "./features/agents/agents-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { useServers } from "./features/servers/servers-context";
import { usePresence } from "./features/team/team-context";
import { useUsage } from "./features/usage/usage-context";
import { usePlatform } from "./platform";
import { createScopeGuard } from "./scope-lifetime";
import { createSimpleContext } from "./simple-context";

/**
 * Opening things: an agent chat, a direct conversation, one message inside
 * either, and the global search that finds them.
 *
 * This is the leaf, and it is a context rather than a set of loose functions
 * because of what `selectAgent` does. One call writes to agents (setup dialog,
 * active id, chat-open revision), to conversation (history pruning, reply
 * indicators, the read-tracking sets) and to direct messages (typing, selection)
 * - three domains, none of which may reach into the others. A command that
 * spans domains belongs below all of them, where it can read every one it needs
 * and nothing can read it back. That is also why nothing here is imported by
 * another context: an edge inward is a cycle, and `noImportCycles` is an error.
 *
 * `messageFocusRequest` is the `{ id, nonce }` request signal the renderer uses
 * elsewhere: the transcript is not this domain's to scroll, so it publishes
 * which message wants focus and the view reacts. The nonce carries the case of
 * focusing the same message twice.
 *
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
      // Past the guards, so a call that opens nothing leaves the report alone.
      dismissUsage();
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
        const page = await window.openbot.agent.searchConversationMessages({ query, limit: 100 });
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
            const latestPage = await window.openbot.agent.readConversationPage({
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
          appendUiError(agentId, error, "Read state failed", serverId);
        }
      } catch (error) {
        appendUiError(agentId, error, "Message load failed", serverId);
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
