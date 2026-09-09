import type {
  AgentEvent,
  AgentRuntimeSnapshot,
  ConversationPage,
  ConversationPageInfo,
  ConversationReadState,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import { createEffect, createMemo, createStore, onCleanup } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import {
  agentMessagesEqual,
  formatTime,
  retainThinkingMessages,
  toAgentMessage,
  toAgentMessages,
  withoutAgent,
} from "../../app-message-projection";
import { createStoredMessage, updateStored } from "../../app-stored-values";
import type { AgentMessage } from "../../data";
import { usePlatform } from "../../platform";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useTurns } from "../../turns";
import { cleanAgentMessageText } from "../agents/agent-message-text";
import { useAgentReadTracking } from "../agents/agent-read-tracking";
import { appendLatestRuntimeMessages } from "../agents/agent-runtime-snapshot";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { notifyTeamTyping } from "../team/team-typing";
import { useUsage } from "../usage/usage-context";
import {
  agentConversationKey,
  agentMessageKey,
  deleteAgentMessageBodies,
  messagePromptRequestKey,
  promptRequestKey,
} from "./conversation-keys";
import { mergeConversationPage, windowedSnapshotMessages } from "./conversation-merge";
import {
  decideAgentAutoRead,
  latestIncomingConversationMessage,
  latestVisibleAgentMessageId,
  preserveKnownAgentUnread,
  readStateForMessages,
  retainedAutoReadState,
} from "./conversation-read-state";
import { useDirectMessages } from "./direct-messages-context";

interface ConversationState {
  messages: AgentMessage[];
  loaded?: boolean;
  revision?: number;
  page?: ConversationPageInfo;
  windowMode?: "latest" | "around";
  references?: Record<string, AgentMessage>;
  olderLoading?: boolean;
  olderError?: string | null;
  read?: ConversationReadState;
  recentReply?: boolean;
}

/**
 * Owns each agent's transcript, page window, read state, and reply indicators
 * inside the existing keyed server scope. Other domains use commands to apply
 * or remove a conversation. Turn and prompt updates stay in these commands
 * because they must agree with the transcript that resolved them.
 *
 * Reads are serialized per conversation. Only the matching automatic read can
 * replace its optimistic state. A failed read leaves a retry marker.
 * The three read-tracking collections belong to `agent-read-tracking.tsx`:
 * their server-qualified requests and retry markers must survive a server
 * switch. Page requests and cached conversation records end with this scope.
 */
const Conversation = createSimpleContext({
  name: "Conversation",
  init: () => {
    const usage = useUsage();
    const { appFocused } = usePlatform();
    const { activeServerId } = useServers();
    const { agentChatsToMarkRead, agentChatsToRetryRead, autoReadAgentMessages } = useAgentReadTracking();
    const scopeIsCurrent = createScopeGuard();
    const { activeDirectMemberId } = useDirectMessages();
    const {
      activeAgent,
      activeAgentId,
      agentStatus,
      agentChatOpenRevision,
      setAgentChatOpenRevision,
      appendUiError,
      analyticsAgentProperties,
      agentSetupOpen,
      explicitlyOpenedAgentChatId,
      uiErrors,
      setUiErrors,
    } = useAgents();
    const {
      completedTurnByAgent,
      pendingPrompts,
      setPendingPrompts,
      presentedPromptResolutions,
      setPresentedPromptResolutions,
      submittedPromptRequests,
      setSubmittedPromptRequests,
      setActiveTurns,
      setTurnProgress,
    } = useTurns();

    const [conversations, setConversations] = createStore<Record<string, ConversationState>>({});
    const rawAgentMessageBodies = new Map<string, string>();

    function updateConversation(agentId: string, update: (conversation: ConversationState) => void): void {
      setConversations((current) => {
        current[agentId] ??= { messages: [] };
        update(current[agentId]);
      });
    }

    // These maps are read projections for the sidebar and Dynamic Island.
    const unreadReplies = createMemo(() =>
      Object.fromEntries(
        Object.entries(conversations).map(([id, conversation]) => [id, conversation.read?.unreadCount ?? 0]),
      ),
    );
    const recentReplies = createMemo(() =>
      Object.fromEntries(
        Object.entries(conversations).map(([id, conversation]) => [id, conversation.recentReply === true]),
      ),
    );

    const pendingConversationSnapshots = new Map<string, ConversationSnapshot>();
    const agentChatsRetriedOnOpen = new Set<string>();
    const conversationPageRequests = new Map<string, number>();
    const conversationReadOperations = new Map<string, Promise<void>>();

    let conversationFrame: number | undefined;

    const activeMessages = createMemo(() => {
      const agent = activeAgent();
      if (!agent) return [];
      const prompt = pendingPrompts()[agent.id];
      const requestKey = prompt?.type === "prompt" ? promptRequestKey(prompt.turnId, prompt.requestId) : null;
      const messages = (conversations[agent.id]?.messages ?? []).filter(
        (message) =>
          message.questionPrompt?.resolution !== null &&
          (!requestKey || messagePromptRequestKey(message) !== requestKey),
      );
      return [...messages, ...(uiErrors()[agentConversationKey(activeServerId(), agent.id)] ?? [])];
    });

    createEffect(
      () => ({ agentId: activeAgentId(), agentPhase: agentStatus().phase, openRevision: agentChatOpenRevision() }),
      ({ agentId }) => {
        if (!agentId) return;
        const serverId = activeServerId();
        const trackingKey = agentConversationKey(serverId, agentId);
        const pageRequest = (conversationPageRequests.get(agentId) ?? 0) + 1;
        conversationPageRequests.set(agentId, pageRequest);
        void window.openbot.agent
          .readConversationPage({ agentId, anchor: { type: "latest" }, limit: 50 }, serverId)
          .then((page) => {
            if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== pageRequest) return;
            const pageApplied = applyConversationPage(page, "replace", "latest");
            if (!pageApplied) {
              if (agentChatsToMarkRead.has(trackingKey)) {
                if (!agentChatsRetriedOnOpen.has(agentId)) {
                  agentChatsRetriedOnOpen.add(agentId);
                  setAgentChatOpenRevision((current) => current + 1);
                } else {
                  agentChatsToMarkRead.delete(trackingKey);
                  markLatestVisibleAgentMessageRead(agentId, serverId);
                }
              }
              return;
            }
            agentChatsRetriedOnOpen.delete(agentId);
            const markReadOnOpen = agentChatsToMarkRead.delete(trackingKey);
            if (markReadOnOpen && (page.readState?.unreadCount ?? 0) > 0) {
              void markAgentMessagesRead(agentId, page.messages.at(-1)?.id ?? null, serverId).catch((error) =>
                appendUiError(agentId, error, "Read state failed", serverId),
              );
            } else if (agentChatsToRetryRead.has(trackingKey) && (page.readState?.unreadCount ?? 0) > 0) {
              const latestIncomingMessage = latestIncomingConversationMessage(page.messages);
              if (latestIncomingMessage) autoMarkAgentMessageRead(agentId, latestIncomingMessage.id);
            }
          })
          .catch((error) => {
            if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== pageRequest) return;
            appendUiError(agentId, error, "Load failed", serverId);
            if (agentChatsToMarkRead.delete(trackingKey)) markLatestVisibleAgentMessageRead(agentId, serverId);
          });
      },
    );

    function initializeConversation(agentId: string): void {
      updateConversation(agentId, (conversation) => {
        conversation.loaded = true;
      });
    }

    function removeConversation(agentId: string): void {
      setConversations((current) => {
        delete current[agentId];
      });
      deleteAgentMessageBodies(rawAgentMessageBodies, agentId);
      pendingConversationSnapshots.delete(agentId);
      conversationPageRequests.delete(agentId);
      agentChatsRetriedOnOpen.delete(agentId);
    }

    function applyRuntimeMessages(messages: AgentRuntimeSnapshot["latestMessages"]): void {
      const agentIds = new Set(messages.map((message) => message.agentId));
      // The draft includes pending page writes from this event batch. Outside
      // the setter, store keys can precede their committed conversation values.
      setConversations((current) => {
        const currentMessages = Object.fromEntries(
          Object.entries(current).map(([id, conversation]) => [id, conversation.messages]),
        );
        const next = appendLatestRuntimeMessages(currentMessages, messages);
        for (const agentId of agentIds) {
          current[agentId] ??= { messages: [] };
          current[agentId].messages = next[agentId] ?? [];
        }
      });
      for (const agentId of agentIds) deleteAgentMessageBodies(rawAgentMessageBodies, agentId);
      for (const message of messages) {
        rawAgentMessageBodies.set(agentMessageKey(message.agentId, message.id), message.text);
      }
    }

    function applyConversationReads(reads: Record<string, ConversationReadState>): void {
      setConversations((current) => {
        for (const [agentId, conversation] of Object.entries(current)) conversation.read = reads[agentId];
        for (const [agentId, read] of Object.entries(reads)) {
          current[agentId] ??= { messages: [] };
          current[agentId].read = read;
        }
      });
    }

    function applyConversationReadState(agentId: string, state: ConversationReadState): void {
      updateConversation(agentId, (conversation) => {
        conversation.read = state;
      });
    }

    function requestConversationRead(agentId: string, explicit = false): void {
      const trackingKey = agentConversationKey(activeServerId(), agentId);
      if (explicit) autoReadAgentMessages.delete(trackingKey);
      agentChatsToMarkRead.add(trackingKey);
      agentChatsRetriedOnOpen.delete(agentId);
      setAgentChatOpenRevision((current) => current + 1);
    }

    function clearRecentReplies(): void {
      setConversations((current) => {
        for (const conversation of Object.values(current)) conversation.recentReply = false;
      });
    }

    function scheduleConversation(snapshot: ConversationSnapshot) {
      const agentId = snapshot.agentId;
      const appliedRevision = conversations[agentId]?.revision ?? -1;
      const pending = pendingConversationSnapshots.get(agentId);
      const pendingRevision = pending?.revision ?? -1;
      if (snapshot.revision < Math.max(appliedRevision, pendingRevision)) return;
      for (const message of snapshot.messages) {
        const key = agentMessageKey(agentId, message.id);
        if (message.author !== "user" && message.status === "streaming") rawAgentMessageBodies.set(key, message.text);
        else rawAgentMessageBodies.delete(key);
      }
      pendingConversationSnapshots.set(agentId, snapshot);
      if (conversationFrame !== undefined) return;
      conversationFrame = requestAnimationFrame(() => {
        conversationFrame = undefined;
        const snapshots = [...pendingConversationSnapshots.values()];
        pendingConversationSnapshots.clear();
        for (const pendingSnapshot of snapshots) {
          applyConversation(pendingSnapshot, isAgentChatReadable(pendingSnapshot.agentId));
        }
      });
    }

    // Usage covers the workspace content and marks it inert, so the chat under it is not the
    // pane the user is looking at. Both readers of this predicate use it to decide whether a
    // message may be marked read, and a message read behind the report was never seen.
    function isAgentChatOpen(agentId: string): boolean {
      return !agentSetupOpen() && !activeDirectMemberId() && !usage.state.serverId && activeAgent()?.id === agentId;
    }

    function isAgentChatReadable(agentId: string): boolean {
      return appFocused() && isAgentChatOpen(agentId);
    }

    /**
     * The fallback for an open whose page never arrived: mark whatever the user
     * can actually see.
     *
     * It is skipped when an optimistic read already names the same boundary,
     * because that read is the same request - either still in flight or already
     * settled - and asking again would only chain a second identical call behind
     * it. The two arrive together whenever a live event advances the chat while
     * the open's page is still on the wire, which is a race, not a rare case.
     */
    function markLatestVisibleAgentMessageRead(agentId: string, serverId: string): void {
      const latestMessageId = latestVisibleAgentMessageId(conversations[agentId]?.messages);
      if (!latestMessageId) return;
      if (autoReadAgentMessages.get(agentConversationKey(serverId, agentId))?.messageId === latestMessageId) return;
      void markAgentMessagesRead(agentId, latestMessageId, serverId).catch((error) =>
        appendUiError(agentId, error, "Read state failed", serverId),
      );
    }

    function refreshAgentReadStateAfterFailure(
      agentId: string,
      messageId: string,
      serverId: string,
      minimumRevision: number,
      fallbackState: ConversationReadState | null,
    ): void {
      const trackingKey = agentConversationKey(serverId, agentId);
      const conversationAtStart = conversations[agentId];
      const applyFallback = () => {
        if (!scopeIsCurrent() || autoReadAgentMessages.has(trackingKey) || !fallbackState) return;
        const latest = conversations[agentId]?.read;
        if (latest?.unreadCount === 0 && latest.throughMessageId === messageId) {
          applyConversationReadState(agentId, fallbackState);
        }
      };
      void window.openbot.agent
        .readConversationPage({ agentId, anchor: { type: "latest" }, limit: 1 }, serverId)
        .then((page) => {
          if (
            !scopeIsCurrent() ||
            conversations[agentId] !== conversationAtStart ||
            autoReadAgentMessages.has(trackingKey) ||
            page.revision < minimumRevision ||
            !page.readState
          ) {
            applyFallback();
            return;
          }
          applyConversationReadState(agentId, page.readState);
        })
        .catch(applyFallback);
    }

    function autoMarkAgentMessageRead(agentId: string, messageId: string, optimisticallyClearUnread = false): void {
      const serverId = activeServerId();
      const trackingKey = agentConversationKey(serverId, agentId);
      const decision = decideAgentAutoRead({
        messageId,
        current: conversations[agentId]?.read,
        tracked: autoReadAgentMessages.get(trackingKey),
        optimisticallyClearUnread,
        explicitlyOpened: explicitlyOpenedAgentChatId() === agentId,
        // Read, not consumed: the flag is spent below, on the one path that asks
        // main. It can only be set on that path anyway - a set flag is what stops
        // the decision being `deferred` - so spending it later changes nothing.
        retryingRead: agentChatsToRetryRead.has(trackingKey),
      });
      if (decision.kind === "deferred") return;
      if (decision.kind === "retained") {
        if (decision.state) applyConversationReadState(agentId, decision.state);
        return;
      }
      agentChatsToRetryRead.delete(trackingKey);
      const optimisticState = decision.optimisticState;
      autoReadAgentMessages.set(trackingKey, { messageId, status: "pending", optimisticState });
      if (optimisticState) applyConversationReadState(agentId, optimisticState);
      void markAgentMessagesRead(agentId, messageId, serverId, (state) => {
        if (autoReadAgentMessages.get(trackingKey)?.messageId !== messageId) return;
        autoReadAgentMessages.set(trackingKey, { messageId, status: "succeeded", state });
      }).catch((error) => {
        if (autoReadAgentMessages.get(trackingKey)?.messageId !== messageId) return;
        autoReadAgentMessages.delete(trackingKey);
        agentChatsToRetryRead.add(trackingKey);
        if (!scopeIsCurrent()) return;
        refreshAgentReadStateAfterFailure(
          agentId,
          messageId,
          serverId,
          conversations[agentId]?.revision ?? -1,
          decision.rollbackState,
        );
        appendUiError(agentId, error, "Read state failed", serverId);
      });
    }

    function applyConversationDelta(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
      if (event.revision <= (conversations[event.agentId]?.revision ?? -1)) return;
      const pendingSnapshot = pendingConversationSnapshots.get(event.agentId);
      if (pendingSnapshot) {
        if (event.revision <= pendingSnapshot.revision) return;
        pendingConversationSnapshots.delete(event.agentId);
        applyConversation(pendingSnapshot, isAgentChatReadable(event.agentId));
      }
      const messageKey = agentMessageKey(event.agentId, event.messageId);
      let appended = false;
      updateConversation(event.agentId, (conversation) => {
        conversation.revision = event.revision;
        const messages = conversation.messages;
        const existing = messages.find((message) => message.id === event.messageId);
        const thinking = existing
          ? undefined
          : messages.find((message) => message.kind === "thinking" && message.itemIds?.includes(event.messageId));
        const thinkingItemIndex = thinking?.itemIds?.indexOf(event.messageId) ?? -1;
        const rawBody =
          (rawAgentMessageBodies.get(messageKey) ??
            existing?.body ??
            (thinkingItemIndex >= 0 ? thinking?.items?.[thinkingItemIndex] : "") ??
            "") + event.delta;
        rawAgentMessageBodies.set(messageKey, rawBody);
        if (existing) {
          updateStored(existing, {
            ...existing,
            body: cleanAgentMessageText(rawBody),
            streaming: true,
          });
          return;
        }
        if (thinking && thinkingItemIndex >= 0) {
          const items = [...(thinking.items ?? [])];
          items[thinkingItemIndex] = cleanAgentMessageText(rawBody);
          updateStored(thinking, { ...thinking, items, streaming: true });
          return;
        }
        const message = createStoredMessage({
          id: event.messageId,
          turnId: event.turnId,
          author: "agent",
          body: cleanAgentMessageText(rawBody),
          time: formatTime(event.createdAt),
          createdAt: event.createdAt,
          streaming: true,
          animate: conversations[event.agentId]?.loaded === true,
          kind: "text",
        });
        appended = true;
        conversation.messages = [...messages, message];
      });
      if (appended) {
        const readState = conversations[event.agentId]?.read;
        if (isAgentChatReadable(event.agentId)) {
          autoMarkAgentMessageRead(event.agentId, event.messageId);
        } else if (readState) {
          applyConversationReadState(event.agentId, {
            ...readState,
            unreadCount: readState.unreadCount + 1,
            firstUnreadMessageId: readState.firstUnreadMessageId ?? event.messageId,
          });
        }
      }
      updateConversation(event.agentId, (conversation) => {
        conversation.loaded = true;
      });
    }

    function applyConversation(snapshot: ConversationSnapshot, markNewMessagesRead = false) {
      const agentId = snapshot.agentId;
      if (snapshot.revision < (conversations[agentId]?.revision ?? -1)) return;
      const initialLoad = conversations[agentId]?.loaded !== true;
      updateConversation(agentId, (conversation) => {
        conversation.revision = snapshot.revision;
        conversation.loaded = true;
        const previous = conversation.messages;
        const previousById = new Map(previous.map((message) => [message.id, message]));
        const allMappedMessages = toAgentMessages(snapshot.messages, snapshot.agentId);
        const pageInfo = conversations[agentId]?.page;
        const windowMode = conversations[agentId]?.windowMode ?? "latest";
        const mappedMessages = retainThinkingMessages(
          previous,
          windowedSnapshotMessages(previous, allMappedMessages, {
            hasOlder: pageInfo?.hasOlder === true,
            mode: windowMode,
          }),
        );
        const next = mappedMessages.map((mapped) => {
          const existing = previousById.get(mapped.id);
          if (!existing) return createStoredMessage({ ...mapped, animate: !initialLoad });
          if (!agentMessagesEqual(existing, mapped)) updateStored(existing, mapped);
          return existing;
        });
        if (previous.length === next.length && previous.every((message, index) => message === next[index])) {
          return;
        }
        conversation.messages = next;
      });
      const presentedRequestKey = presentedPromptResolutions()[agentId];
      const pendingPrompt = pendingPrompts()[agentId];
      const pendingRequestKey =
        pendingPrompt?.type === "prompt" ? promptRequestKey(pendingPrompt.turnId, pendingPrompt.requestId) : null;
      const submittedRequestKey = submittedPromptRequests()[agentId];
      const resolvedPendingPrompt =
        pendingRequestKey !== null &&
        snapshot.messages.some(
          (message) =>
            messagePromptRequestKey(message) === pendingRequestKey && message.questionPrompt?.resolution !== null,
        );
      if (
        presentedRequestKey &&
        snapshot.messages.some(
          (message) =>
            messagePromptRequestKey(message) === presentedRequestKey && message.questionPrompt?.resolution !== null,
        )
      ) {
        setPendingPrompts((current) => ({ ...current, [agentId]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
      } else if (
        resolvedPendingPrompt &&
        (activeAgent()?.id !== agentId || !submittedRequestKey || submittedRequestKey !== pendingRequestKey)
      ) {
        setPendingPrompts((current) => ({ ...current, [agentId]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
      }
      setActiveTurns((current) => ({
        ...current,
        [agentId]: completedTurnByAgent.get(agentId) === snapshot.activeTurnId ? null : snapshot.activeTurnId,
      }));
      setTurnProgress((current) => {
        const progress = current[agentId];
        return progress && progress.turnId !== snapshot.activeTurnId ? withoutAgent(current, agentId) : current;
      });
      const readState = conversations[agentId]?.read;
      const latestIncomingMessage = markNewMessagesRead
        ? latestIncomingConversationMessage(snapshot.messages)
        : undefined;
      if (latestIncomingMessage) {
        autoMarkAgentMessageRead(agentId, latestIncomingMessage.id);
      } else if (readState) {
        applyConversationReadState(agentId, readStateForMessages(readState, snapshot.messages));
      }
    }

    function applyConversationPage(
      page: ConversationPage,
      merge: "replace" | "older" | "latest",
      windowMode?: "latest" | "around",
    ): boolean {
      if (page.revision < (conversations[page.agentId]?.revision ?? -1)) return false;
      for (const message of page.messages) {
        const key = agentMessageKey(page.agentId, message.id);
        if (message.author !== "user" && message.status === "streaming") rawAgentMessageBodies.set(key, message.text);
        else rawAgentMessageBodies.delete(key);
      }
      const mapped = toAgentMessages(page.messages, page.agentId);
      updateConversation(page.agentId, (conversation) => {
        const currentMessages = conversation.messages;
        const currentById = new Map(currentMessages.map((message) => [message.id, message]));
        const pageMessages = mapped.map((message) => {
          const stored = currentById.get(message.id);
          if (!stored) return createStoredMessage({ ...message, animate: false });
          if (!agentMessagesEqual(stored, message)) updateStored(stored, { ...message, animate: stored.animate });
          return stored;
        });
        conversation.messages = mergeConversationPage(currentMessages, pageMessages, merge);
        conversation.references = {
          ...(merge === "replace" ? {} : conversation.references),
          ...Object.fromEntries(
            Object.entries(page.references).map(([id, message]) => [id, toAgentMessage(message, page.agentId)]),
          ),
        };
        conversation.page = page.pageInfo;
        if (windowMode) conversation.windowMode = windowMode;
        conversation.revision = page.revision;
        conversation.loaded = true;
      });
      setActiveTurns((current) => ({
        ...current,
        [page.agentId]: completedTurnByAgent.get(page.agentId) === page.activeTurnId ? null : page.activeTurnId,
      }));
      if (page.readState && merge !== "older") {
        const trackedAutoRead = autoReadAgentMessages.get(agentConversationKey(activeServerId(), page.agentId));
        const latestIncomingMessage = latestIncomingConversationMessage(page.messages);
        const retainedState =
          trackedAutoRead && trackedAutoRead.messageId === latestIncomingMessage?.id
            ? retainedAutoReadState(trackedAutoRead)
            : null;
        applyConversationReadState(page.agentId, retainedState ?? page.readState);
      }
      return true;
    }

    async function loadOlderAgentMessages(agentId = activeAgent()?.id): Promise<void> {
      if (!agentId || conversations[agentId]?.olderLoading) return;
      const pageInfo = conversations[agentId]?.page;
      if (!pageInfo?.hasOlder || !pageInfo.olderCursor) return;
      const cursor = pageInfo.olderCursor;
      const conversationAtStart = conversations[agentId];
      const requestVersion = conversationPageRequests.get(agentId);
      const requestIsCurrent = () =>
        scopeIsCurrent() &&
        conversationPageRequests.get(agentId) === requestVersion &&
        conversations[agentId] !== undefined;
      updateConversation(agentId, (conversation) => {
        conversation.olderLoading = true;
        conversation.olderError = null;
      });
      try {
        const page = await window.openbot.agent.readConversationPage({
          agentId,
          anchor: { type: "before", cursor },
          limit: 50,
        });
        if (!requestIsCurrent()) return;
        if (conversations[agentId]?.page?.olderCursor !== cursor) return;
        applyConversationPage(page, "older");
      } catch (error) {
        if (!requestIsCurrent()) return;
        updateConversation(agentId, (conversation) => {
          conversation.olderError = error instanceof Error ? error.message : "Older messages could not load.";
        });
      } finally {
        if (scopeIsCurrent() && conversations[agentId] === conversationAtStart) {
          updateConversation(agentId, (conversation) => {
            conversation.olderLoading = false;
          });
        }
      }
    }

    async function searchAgentMessages(
      agentId: string,
      query: string,
    ): Promise<{ messageIds: string[]; total: number }> {
      const analytics = desktopAnalytics.scope();
      try {
        const page = await window.openbot.agent.searchConversationMessages({ query, agentId, limit: 100 });
        analytics.track("search_action", { scope: "agent", result: "succeeded", result_count: page.total });
        return { messageIds: page.results.map((result) => result.message.id), total: page.total };
      } catch (error) {
        analytics.track("search_action", { scope: "agent", result: "failed", failure_code: "search_failed" });
        throw error;
      }
    }

    function pruneInactiveAgentHistory(agentId: string): void {
      const messages = conversations[agentId]?.messages;
      if (!messages || messages.length <= 50) return;
      updateConversation(agentId, (conversation) => {
        if (conversation.messages.length <= 50) return;
        conversation.messages = conversation.messages.slice(-50);
        conversation.references = {};
        conversation.page = { hasOlder: true, olderCursor: null };
      });
    }

    async function loadLatestAgentMessages(agentId: string): Promise<void> {
      const request = (conversationPageRequests.get(agentId) ?? 0) + 1;
      conversationPageRequests.set(agentId, request);
      const page = await window.openbot.agent.readConversationPage({
        agentId,
        anchor: { type: "latest" },
        limit: 50,
      });
      if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== request) return;
      applyConversationPage(page, "replace", "latest");
    }

    async function loadAgentMessagePage(agentId: string, messageId: string): Promise<ConversationPage | null> {
      const request = (conversationPageRequests.get(agentId) ?? 0) + 1;
      conversationPageRequests.set(agentId, request);
      const page = await window.openbot.agent.readConversationPage({
        agentId,
        anchor: { type: "around", messageId },
        limit: 50,
      });
      if (conversationPageRequests.get(agentId) !== request || !scopeIsCurrent()) return null;
      if (!page.messages.some((message) => message.id === messageId)) {
        throw new Error("This message is no longer available.");
      }
      applyConversationPage(page, "replace", "around");
      return page;
    }

    function markReplyCompleted(agentId: string) {
      clearRecentReply(agentId);
      if (appFocused()) return;
      updateConversation(agentId, (conversation) => {
        conversation.recentReply = true;
      });
    }

    function clearRecentReply(agentId: string) {
      if (!conversations[agentId]?.recentReply) return;
      updateConversation(agentId, (conversation) => {
        conversation.recentReply = false;
      });
    }

    async function sendMessage(
      body: string,
      attachmentDraftIds: string[],
      replyToMessageId: string | null,
      target?: { agentId: string; serverId: string },
    ): Promise<boolean> {
      const agentId = target?.agentId ?? activeAgent()?.id;
      const serverId = target?.serverId ?? activeServerId();
      if (!agentId || (!body.trim() && attachmentDraftIds.length === 0)) return false;
      return sendMessageToAgent(agentId, body, attachmentDraftIds, replyToMessageId, serverId);
    }

    async function sendMessageToAgent(
      agentId: string,
      body: string,
      attachmentDraftIds: string[],
      replyToMessageId: string | null = null,
      serverId = activeServerId(),
    ): Promise<boolean> {
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      try {
        const input = {
          agentId,
          text: body.trim(),
          attachmentDraftIds,
          ...(replyToMessageId ? { replyToMessageId } : {}),
        };
        const receipt = await window.openbot.agent.sendMessage(input, serverId);
        const errorKey = agentConversationKey(serverId, agentId);
        setUiErrors((current) => ({ ...current, [errorKey]: [] }));
        analytics.track("message_send", {
          ...(properties ?? {}),
          channel: "agent",
          attachment_count: attachmentDraftIds.length,
          is_reply: replyToMessageId !== null,
          result: "succeeded",
          delivery_count: receipt.deliveries.length,
        });
        try {
          await markAgentMessagesRead(agentId, receipt.deliveries[0]?.id ?? receipt.messageId, serverId);
        } catch (error) {
          appendUiError(agentId, error, "Read state failed", serverId);
        }
        return true;
      } catch (error) {
        analytics.track("message_send", {
          ...(properties ?? {}),
          channel: "agent",
          attachment_count: attachmentDraftIds.length,
          is_reply: replyToMessageId !== null,
          result: "failed",
          failure_code: "send_failed",
        });
        appendUiError(agentId, error, "Send failed", serverId);
        return false;
      }
    }

    async function markAgentMessagesRead(
      agentId = activeAgent()?.id,
      throughMessageId?: string | null,
      serverId = activeServerId(),
      onSuccess?: (state: ConversationReadState) => void,
    ): Promise<void> {
      if (!agentId || !scopeIsCurrent()) return;
      const requestKey = agentConversationKey(serverId, agentId);
      const conversationAtStart = conversations[agentId];
      const visibleMessageIdAtStart = latestVisibleAgentMessageId(conversations[agentId]?.messages);
      const boundary =
        throughMessageId ??
        conversations[agentId]?.messages
          ?.filter((message) => !message.id.startsWith("thinking:") && !message.id.startsWith("ui-"))
          .at(-1)?.id ??
        null;
      const previousOperation = conversationReadOperations.get(requestKey) ?? Promise.resolve();
      const operation: Promise<void> = previousOperation
        .catch(() => undefined)
        .then(async () => {
          const state: ConversationReadState = await window.openbot.agent.markConversationRead(
            {
              agentId,
              throughMessageId: boundary,
            },
            serverId,
          );
          agentChatsToRetryRead.delete(requestKey);
          const nextState = isAgentChatReadable(agentId)
            ? state
            : preserveKnownAgentUnread(state, boundary, conversations[agentId]?.messages ?? []);
          onSuccess?.(nextState);
          const trackedAutoRead = autoReadAgentMessages.get(requestKey);
          const supersededByAutoRead = Boolean(trackedAutoRead && trackedAutoRead.messageId !== boundary);
          if (scopeIsCurrent() && conversations[agentId] === conversationAtStart && !supersededByAutoRead) {
            applyConversationReadState(agentId, nextState);
            if (nextState.unreadCount === 0) clearRecentReply(agentId);
          }
          const latestMessageId = latestVisibleAgentMessageId(conversations[agentId]?.messages);
          if (
            conversationReadOperations.get(requestKey) === operation &&
            scopeIsCurrent() &&
            isAgentChatReadable(agentId) &&
            latestMessageId &&
            latestMessageId !== boundary &&
            latestMessageId !== visibleMessageIdAtStart
          ) {
            queueMicrotask(() => {
              const latestVisibleMessageId = latestVisibleAgentMessageId(conversations[agentId]?.messages);
              if (
                scopeIsCurrent() &&
                isAgentChatReadable(agentId) &&
                latestVisibleMessageId &&
                latestVisibleMessageId !== boundary &&
                latestVisibleMessageId !== visibleMessageIdAtStart
              ) {
                void markAgentMessagesRead(agentId, latestVisibleMessageId, serverId).catch((error) =>
                  appendUiError(agentId, error, "Read state failed", serverId),
                );
              }
            });
          }
        });
      conversationReadOperations.set(requestKey, operation);
      try {
        await operation;
      } finally {
        if (conversationReadOperations.get(requestKey) === operation) conversationReadOperations.delete(requestKey);
      }
    }

    function presentPromptResolution(agentId: string, turnId: string, requestId: string | number): void {
      const requestKey = promptRequestKey(turnId, requestId);
      if (!requestKey) return;
      const currentPrompt = pendingPrompts()[agentId];
      if (
        currentPrompt?.type !== "prompt" ||
        promptRequestKey(currentPrompt.turnId, currentPrompt.requestId) !== requestKey
      ) {
        return;
      }
      const persisted = (conversations[agentId]?.messages ?? []).some(
        (message) => messagePromptRequestKey(message) === requestKey && message.questionPrompt?.resolution !== null,
      );
      if (persisted) {
        setPendingPrompts((current) => ({ ...current, [agentId]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
        return;
      }
      setPresentedPromptResolutions((current) => ({ ...current, [agentId]: requestKey }));
    }

    // The scheduler holds a frame handle across the microtask boundary, so the
    // provider owns cancelling it. Nothing else here needs teardown.
    onCleanup(() => {
      if (conversationFrame !== undefined) cancelAnimationFrame(conversationFrame);
    });

    return {
      conversations,
      unreadReplies,
      recentReplies,
      activeMessages,
      agentChatsToRetryRead,
      initializeConversation,
      removeConversation,
      applyRuntimeMessages,
      requestConversationRead,
      clearRecentReplies,
      applyConversationReads,
      scheduleConversation,
      isAgentChatOpen,
      isAgentChatReadable,
      autoMarkAgentMessageRead,
      applyConversationDelta,
      applyConversationPage,
      loadOlderAgentMessages,
      loadLatestAgentMessages,
      loadAgentMessagePage,
      pruneInactiveAgentHistory,
      markReplyCompleted,
      clearRecentReply,
      searchAgentMessages,
      sendMessage,
      markAgentMessagesRead,
      presentPromptResolution,
      setTeamTyping: notifyTeamTyping,
    };
  },
});

export const ConversationProvider = Conversation.provider;
export const useConversation = Conversation.use;
