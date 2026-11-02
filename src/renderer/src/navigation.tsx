import type { GlobalSearchPage } from "@openbot/ui/components/GlobalSearch";
import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, onSettled, untrack } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { toAgentMessage } from "./app-message-projection";
import { appPort } from "./app-port";
import { type ChatHistoryEntry, chatHistoryShortcut, createChatHistory } from "./chat-history";
import { useAgentThreads } from "./features/agent-threads/agent-threads-context";
import { useAgents } from "./features/agents/agents-context";
import { useChannels } from "./features/channels/channels-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { useServers } from "./features/servers/servers-context";
import { usePresence } from "./features/team/team-context";
import { useWindowPage } from "./features/window/window-page-context";
import { usePlatform } from "./platform";
import { createScopeGuard } from "./scope-lifetime";
import { createSimpleContext } from "./simple-context";

/**
 * Cross-domain open/select commands (agent chat, direct conversation, message focus, global
 * search). Leaf context below agents/conversation/direct-messages so one call can write to
 * all three without cycles (`noImportCycles` is an error). See docs/architecture/change-rules.md.
 * Ungated - see `app-providers.tsx`.
 */
const Navigation = createSimpleContext({
  name: "Navigation",
  init: () => {
    const platform = usePlatform();
    const { peopleEnabled } = platform;
    const { activeServerId } = useServers();
    const { currentTeamMember, directPeople } = usePresence();
    const {
      agentList,
      activeAgent,
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
    const { activeDirectMember, setDirectTyping, clearDirectSelection, openDirectConversation } = useDirectMessages();
    const channels = useChannels();
    const agentThreads = useAgentThreads();
    const windowPage = useWindowPage();
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

    /** False when the chat opens in another window. */
    function selectAgent(agentId: string): boolean {
      if (agentSetupOpen() && creatingAgent()) return false;
      // A chat window shows its one chat, and main marks that chat in the sidebar. Another agent
      // opens in its own chat window, from search, a schedule or the Dynamic Island.
      const chatWindow = platform.chatWindow;
      if (chatWindow && agentId !== chatWindow.agentId) {
        void appPort().openChatWindow({ serverId: chatWindow.serverId, agentId });
        return false;
      }
      // The rail and the sidebar sit outside the markup the report covers, so a
      // conversation is one click away while the report hides where it opens. Opening
      // one that stays hidden also reads it: `requestConversationRead` below is the
      // explicit read, and a search result runs `openAgentMessage`, which marks every
      // message through the match. Both would be messages nobody saw. The settings page covers the
      // conversation in the same way.
      windowPage.showAgents();
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
      return true;
    }

    async function selectDirectMember(memberId: string): Promise<void> {
      if (agentSetupOpen() && creatingAgent()) return;
      if (!peopleEnabled || !currentTeamMember() || !directPeople().some((member) => member.id === memberId)) return;
      // Past the guards, so a call that opens nothing leaves the page or the channel alone.
      windowPage.showAgents();
      channels.close();
      const previousAgentId = activeAgentId();
      if (previousAgentId) pruneInactiveAgentHistory(previousAgentId);
      setExplicitlyOpenedAgentChatId(null);
      setAgentSetupOpen(false);
      setAgentSetupError(null);
      setSettingsRequest(null);
      await openDirectConversation(memberId);
    }

    // The element that had focus before the search opened. A dialog that the search opens returns
    // focus to it, because the search input is gone when that dialog closes.
    let globalSearchOpener: HTMLElement | null = null;

    function setGlobalSearchVisibility(open: boolean): void {
      if (open && !globalSearchOpen()) {
        globalSearchOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      setGlobalSearchOpen(open);
    }

    /** The side thread of each message that the last search found there, by agent and message id. */
    const searchHitThreads = new Map<string, string>();
    const searchHitKey = (agentId: string, messageId: string) => `${agentId}\n${messageId}`;

    async function searchGlobalMessages(
      query: string,
      cursor?: string,
    ): Promise<GlobalSearchPage<{ agentId: string; message: AgentMessage }>> {
      const analytics = desktopAnalytics.scope();
      try {
        const page = await appPort().agent.searchConversationMessages({
          query,
          ...(cursor === undefined ? {} : { cursor }),
          limit: 100,
          includeSideThreads: true,
        });
        if (cursor === undefined) searchHitThreads.clear();
        for (const result of page.results) {
          if (result.taskId) searchHitThreads.set(searchHitKey(result.agentId, result.message.id), result.taskId);
        }
        // One search counts once, not once per page.
        if (cursor === undefined) {
          analytics.track("search_action", { scope: "global", result: "succeeded", result_count: page.total });
        }
        return {
          results: page.results.map((result) => ({
            agentId: result.agentId,
            message: toAgentMessage(result.message, result.agentId),
          })),
          total: page.total,
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        if (cursor === undefined) {
          analytics.track("search_action", { scope: "global", result: "failed", failure_code: "search_failed" });
        }
        throw error;
      }
    }

    function selectGlobalSearchMessage(agentId: string, messageId: string): void {
      // A side thread loads its whole conversation in its tab. Its tab is written first, so a chat
      // window that opens for the agent reads it.
      const taskId = searchHitThreads.get(searchHitKey(agentId, messageId));
      if (taskId) {
        agentThreads.open(agentId, taskId);
        selectAgent(agentId);
        return;
      }
      // The other window reads the chat when it opens. This one does not mark its messages read.
      if (!selectAgent(agentId) && platform.chatWindow) return;
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

    const history = createChatHistory((entry) => {
      if (entry.kind === "agent") return agentList().some((agent) => agent.id === entry.id);
      if (entry.kind === "channel") {
        return (
          channels.supported() &&
          channels.state.channels.some((channel) => channel.id === entry.id && !channel.archived)
        );
      }
      return peopleEnabled && directPeople().some((member) => member.id === entry.id);
    });
    /** The index that Back or Forward opens. The chat records it when it opens; a refused open keeps it until then. */
    let historyTarget: number | null = null;

    /** The chat that the sidebar marks as open. A page or the new agent form has none. */
    const openChat = (): ChatHistoryEntry | null => {
      if (windowPage.page() !== "agents" || agentSetupOpen()) return null;
      const channelId = channels.state.selectedId;
      if (channelId) return { kind: "channel", id: channelId };
      const member = activeDirectMember();
      if (member) return { kind: "person", id: member.id };
      const agent = activeAgent();
      return agent ? { kind: "agent", id: agent.id } : null;
    };
    createEffect(
      () => {
        const entry = openChat();
        return entry ? `${entry.kind}:${entry.id}` : null;
      },
      () =>
        untrack(() => {
          const entry = openChat();
          if (!entry) return;
          history.record(entry, historyTarget);
          historyTarget = null;
        }),
    );

    function goInHistory(offset: 1 | -1): void {
      const index = history.nearest(offset);
      const entry = history.entryAt(index);
      if (!entry) return;
      historyTarget = index;
      if (entry.kind === "agent") selectAgent(entry.id);
      else if (entry.kind === "channel") void channels.open(entry.id);
      else void selectDirectMember(entry.id);
    }
    const goBack = () => goInHistory(-1);
    const goForward = () => goInHistory(1);

    /** A dialog or menu over the chat keeps its keys and mouse buttons. */
    const handledElsewhere = (event: Event): boolean =>
      event.defaultPrevented ||
      (event.target instanceof Element &&
        event.target.closest("[role=dialog], [role=alertdialog], [role=menu]") !== null);

    onSettled(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (handledElsewhere(event)) return;
        const command = chatHistoryShortcut(event, platform.appInfo()?.platform === "darwin");
        if (!command) return;
        event.preventDefault();
        if (command === "back") goBack();
        else goForward();
      };
      // The side buttons of a mouse.
      const onMouseUp = (event: MouseEvent) => {
        if (handledElsewhere(event)) return;
        if (event.button === 3) goBack();
        else if (event.button === 4) goForward();
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("mouseup", onMouseUp);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("mouseup", onMouseUp);
      };
    });

    return {
      selectAgent,
      selectDirectMember,
      openAgentMessage,
      messageFocusRequest,
      globalSearchOpen,
      setGlobalSearchVisibility,
      globalSearchOpener: () => globalSearchOpener,
      searchGlobalMessages,
      selectGlobalSearchMessage,
      chatHistory: { previous: history.previous, next: history.next, goBack, goForward },
    };
  },
});

export const NavigationProvider = Navigation.provider;
export const useNavigation = Navigation.use;
