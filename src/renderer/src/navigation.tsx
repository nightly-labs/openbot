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

    function selectAgent(agentId: string, tabId?: string): boolean {
      if (agentSetupOpen() && creatingAgent()) return false;
      return openAgent(agentId, tabId);
    }

    function openCreatedAgent(agentId: string): boolean {
      return openAgent(agentId);
    }

    function openAgent(agentId: string, tabId?: string): boolean {
      if (tabId !== undefined) agentThreads.open(agentId, tabId);
      const chatWindow = platform.chatWindow;
      if (chatWindow && agentId !== chatWindow.agentId) {
        void appPort().openChatWindow({ serverId: chatWindow.serverId, agentId });
        return false;
      }
      windowPage.showAgents();
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

    let globalSearchOpener: HTMLElement | null = null;

    function setGlobalSearchVisibility(open: boolean): void {
      if (open && !globalSearchOpen()) {
        globalSearchOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      setGlobalSearchOpen(open);
    }

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
      const taskId = searchHitThreads.get(searchHitKey(agentId, messageId));
      if (taskId) {
        agentThreads.open(agentId, taskId);
        selectAgent(agentId);
        return;
      }
      if (!selectAgent(agentId) && platform.chatWindow) return;
      void openAgentMessage(agentId, messageId);
    }

    async function openAgentMessage(agentId: string, messageId: string): Promise<boolean> {
      const serverId = activeServerId();
      await Promise.resolve();
      if (!scopeIsCurrent()) return false;
      try {
        const page = await loadAgentMessagePage(agentId, messageId);
        if (!page) return false;
        setMessageFocusRequest({ agentId, messageId, nonce: Date.now() });
        try {
          let readBoundary = page.messages.at(-1)?.id ?? messageId;
          try {
            if (!scopeIsCurrent()) return true;
            const latestPage = await appPort().agent.readConversationPage({
              agentId,
              anchor: { type: "latest" },
              limit: 1,
            });
            if (!scopeIsCurrent()) return true;
            readBoundary = latestPage.messages.at(-1)?.id ?? readBoundary;
          } catch {}
          await markAgentMessagesRead(agentId, readBoundary, serverId);
        } catch (error) {
          appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
        }
        return true;
      } catch (error) {
        appendUiError(agentId, error, currentText().t("app.errorStatus.messageLoad"), serverId);
        return false;
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
    let historyTarget: number | null = null;

    const currentChat = (): ChatHistoryEntry | null => {
      if (agentSetupOpen()) return null;
      const channelId = channels.state.selectedId;
      if (channelId) return { kind: "channel", id: channelId };
      const member = activeDirectMember();
      if (member) return { kind: "person", id: member.id };
      const agent = activeAgent();
      return agent ? { kind: "agent", id: agent.id } : null;
    };
    const openChat = (): ChatHistoryEntry | null => (windowPage.page() === "agents" ? currentChat() : null);
    const chatUnderPage = (): ChatHistoryEntry | null => (windowPage.page() === "agents" ? null : currentChat());
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
    const goBack = () => {
      const pageBack = windowPage.pageBack();
      if (pageBack) pageBack.back();
      else if (chatUnderPage()) windowPage.showAgents();
      else goInHistory(-1);
    };
    const goForward = () => goInHistory(1);

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
      openCreatedAgent,
      selectDirectMember,
      openAgentMessage,
      messageFocusRequest,
      globalSearchOpen,
      setGlobalSearchVisibility,
      globalSearchOpener: () => globalSearchOpener,
      searchGlobalMessages,
      selectGlobalSearchMessage,
      chatHistory: {
        previous: history.previous,
        next: history.next,
        pageBack: windowPage.pageBack,
        chatUnderPage,
        goBack,
        goForward,
      },
    };
  },
});

export const NavigationProvider = Navigation.provider;
export const useNavigation = Navigation.use;
