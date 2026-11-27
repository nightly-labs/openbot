import {
  type AgentEvent,
  type AgentRuntimeSnapshot,
  CONVERSATION_SNAPSHOT_MESSAGE_LIMIT,
  type ConversationPage,
  type ConversationPageInfo,
  type ConversationReadState,
  type ConversationSnapshot,
  openExchangesOutside,
} from "@openbot/contracts/ipc";
import { THREAD_MESSAGE_SEARCH_PAGE_LIMIT } from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import type { AgentMessage, ComposerThreadMessageMatch } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onCleanup, untrack } from "solid-js";
import { noteAgentRequest } from "../../agent-requests";
import { desktopAnalytics } from "../../analytics";
import {
  agentMessagesEqual,
  collectThreadMessageMatches,
  formatMessageTime,
  retainThinkingMessages,
  toAgentMessage,
  toAgentMessages,
} from "../../app-message-projection";
import { createStoredMessage, updateStored } from "../../app-stored-values";
import { rendererPerfCount } from "../../perf-count";
import { usePlatform } from "../../platform";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useTurns } from "../../turns";
import { isConnectionDrop, useUiErrors } from "../../ui-errors";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentReadTracking } from "../agents/agent-read-tracking";
import { appendLatestRuntimeMessages, attentionKey } from "../agents/agent-runtime-snapshot";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useServers } from "../servers/servers-context";
import { notifyTeamTyping } from "../team/team-typing";
import { useWindowPage } from "../window/window-page-context";
import { takeAttachmentKinds } from "./attachment-analytics";
import {
  agentConversationKey,
  agentMessageKey,
  deleteAgentMessageBodies,
  messagePromptRequestKey,
  promptRequestKey,
} from "./conversation-keys";
import { mergeConversationPage, missingReplyOriginals, windowedSnapshotMessages } from "./conversation-merge";
import { conversationPort } from "./conversation-port";
import {
  decideAgentAutoRead,
  latestIncomingConversationMessage,
  latestVisibleAgentMessageId,
  preserveKnownAgentUnread,
  readStateForMessages,
  retainedAutoReadState,
} from "./conversation-read-state";
import type { ConversationMessagePins, SendMessageResult } from "./conversation-types";
import { useDirectMessages } from "./direct-messages-context";
import { noteAgentMessageSent } from "./github-star-prompt";
import { noteSocialFollowMessageSent } from "./social-follow-prompt";

type ConversationDeltaEvent = Extract<AgentEvent, { type: "conversation-delta" }>;

const LATEST_PAGE_SIZE = 50;
const REMOTE_LATEST_PAGE_SIZE = 24;
const INACTIVE_SNAPSHOT_TAIL = LATEST_PAGE_SIZE * 4;

function trimToLatestPage(conversation: ConversationState): void {
  if (conversation.messages.length <= LATEST_PAGE_SIZE) return;
  const kept = conversation.messages.slice(-LATEST_PAGE_SIZE);
  const removedById = new Map(
    conversation.messages.slice(0, -LATEST_PAGE_SIZE).map((message) => [message.id, message]),
  );
  const references: Record<string, AgentMessage> = {};
  for (const message of kept) {
    const originalId = message.replyToMessageId;
    const original = originalId ? (removedById.get(originalId) ?? conversation.references?.[originalId]) : undefined;
    if (originalId && original) references[originalId] = original;
  }
  conversation.messages = kept;
  conversation.references = references;
  conversation.page = { hasOlder: true, olderCursor: null };
}

function lacksOlderCursor(page: ConversationPageInfo | undefined): boolean {
  return !page || (page.hasOlder && !page.olderCursor);
}

function pageReferences(page: ConversationPage): Record<string, AgentMessage> {
  return Object.fromEntries(
    Object.entries(page.references).map(([id, message]) => [id, toAgentMessage(message, page.agentId)]),
  );
}

interface ConversationState {
  messages: AgentMessage[];
  loaded?: boolean;
  loading?: boolean;
  loadError?: string | null;
  revision?: number;
  page?: ConversationPageInfo;
  windowMode?: "latest" | "around";
  references?: Record<string, AgentMessage>;
  missingReferences?: Record<string, true>;
  olderLoading?: boolean;
  olderError?: string | null;
  read?: ConversationReadState | undefined;
  recentReply?: boolean;
}

const Conversation = createSimpleContext({
  name: "Conversation",
  init: () => {
    const windowPage = useWindowPage();
    const { appFocused, chatWindow } = usePlatform();
    const { activeServerId, activeServer } = useServers();
    const { agentChatsToMarkRead, agentChatsToRetryRead, autoReadAgentMessages } = useAgentReadTracking();
    const scopeIsCurrent = createScopeGuard();
    const agentTasks = useAgentTasks();
    const { activeDirectMemberId } = useDirectMessages();
    const channels = useChannels();
    const {
      activeAgent,
      activeAgentId,
      agentList,
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
      activeTurns,
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
    const { clearUiErrors } = useUiErrors();
    const { centralAuth } = useAuth();
    const prefetchedConversationPages = new Map<string, ConversationPage>();
    const signedInAccount = createMemo(() => {
      const auth = centralAuth();
      return auth.status === "signed_in" ? auth.user.id : null;
    });
    createEffect(signedInAccount, (account, previous) => {
      if (previous === undefined || account === previous) return;
      prefetchedConversationPages.clear();
      if (account) clearUiErrors(currentText().t("chat.errorStatus.readState"));
    });

    const [conversations, writeConversations] = createStore<Record<string, ConversationState>>({});
    const rawAgentMessageBodies = new Map<string, string>();
    let queuedDeltas: ConversationDeltaEvent[] = [];
    let cancelDeltaFrame: (() => void) | undefined;

    function setConversations(update: (current: Record<string, ConversationState>) => void): void {
      flushConversationDeltas();
      writeConversations(update);
    }

    function updateConversation(agentId: string, update: (conversation: ConversationState) => void): void {
      setConversations((current) => {
        current[agentId] ??= { messages: [] };
        update(current[agentId]);
      });
    }

    function latestPageSize(agentId: string, remote: boolean) {
      if (!remote || (conversations[agentId]?.read?.unreadCount ?? 0) > 0) return LATEST_PAGE_SIZE;
      return REMOTE_LATEST_PAGE_SIZE;
    }

    const unreadReplies = createMemo(() =>
      Object.fromEntries(
        Object.entries(conversations).map(([id, conversation]) => [id, conversation.read?.unreadCount ?? 0]),
      ),
    );
    const agentUnreadReplies = createMemo(() => {
      const counts = { ...unreadReplies() };
      for (const [id, count] of Object.entries(agentTasks.unreadTotals())) counts[id] = (counts[id] ?? 0) + count;
      return counts;
    });
    const recentReplies = createMemo(() =>
      Object.fromEntries(
        Object.entries(conversations).map(([id, conversation]) => [id, conversation.recentReply === true]),
      ),
    );

    const pendingConversationSnapshots = new Map<string, ConversationSnapshot>();
    const agentChatsRetriedOnOpen = new Set<string>();
    const conversationPageRequests = new Map<string, number>();
    const conversationReadOperations = new Map<string, Promise<void>>();
    const heldUnreadAgentChats = new Set<string>();

    let cancelConversationFrame: (() => void) | undefined;

    function onNextFrame(run: () => void): () => void {
      if (document.visibilityState === "hidden") {
        const timer = setTimeout(run);
        return () => clearTimeout(timer);
      }
      const frame = requestAnimationFrame(run);
      return () => cancelAnimationFrame(frame);
    }

    function ownChatAttentionKey(agentId: string): string {
      const agent = agentList().find((candidate) => candidate.id === agentId);
      return attentionKey(agentId, agent?.threadId ?? null);
    }

    const activeMessages = createMemo(() => {
      const agent = activeAgent();
      if (!agent) return [];
      const prompt = pendingPrompts()[attentionKey(agent.id, agent.threadId)];
      const requestKey = prompt?.type === "prompt" ? promptRequestKey(prompt.turnId, prompt.requestId) : null;
      const messages = (conversations[agent.id]?.messages ?? []).filter(
        (message) =>
          message.questionPrompt?.resolution !== null &&
          (!requestKey || messagePromptRequestKey(message) !== requestKey),
      );
      return [...messages, ...(uiErrors()[agentConversationKey(activeServerId(), agent.id)] ?? [])];
    });

    createEffect(
      () => ({
        agentId: activeAgentId(),
        agentPhase: agentStatus().phase,
        openRevision: agentChatOpenRevision(),
        serverState: activeServer()?.state,
        sequence: activeServer()?.connectionSequence,
      }),
      (next, previous) => {
        if (
          previous &&
          next.agentId === previous.agentId &&
          next.agentPhase === previous.agentPhase &&
          next.openRevision === previous.openRevision &&
          next.serverState === previous.serverState &&
          next.sequence === previous.sequence
        ) {
          return;
        }
        const { agentId } = next;
        if (!agentId) return;
        const serverId = untrack(activeServerId);
        const trackingKey = agentConversationKey(serverId, agentId);
        const pageRequest = (conversationPageRequests.get(agentId) ?? 0) + 1;
        conversationPageRequests.set(agentId, pageRequest);
        const server = untrack(activeServer);
        if (server?.kind === "remote" && server.state !== "online") return;
        const prefetched = prefetchedConversationPages.get(agentId);
        if (prefetched) {
          prefetchedConversationPages.delete(agentId);
          if (untrack(() => prefetchedPageIsCurrent(prefetched)))
            applyConversationPage(prefetched, "replace", "latest");
        }
        updateConversation(agentId, (conversation) => {
          conversation.loading = true;
          conversation.loadError = null;
        });
        void conversationPort()
          .agent.readConversationPage(
            {
              agentId,
              anchor: { type: "latest" },
              limit: untrack(() => latestPageSize(agentId, server?.kind === "remote")),
            },
            serverId,
          )
          .then((page) => {
            if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== pageRequest) return;
            updateConversation(agentId, (conversation) => {
              conversation.loading = false;
            });
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
                reportAutomaticReadFailure(agentId, error, serverId),
              );
            } else if (
              agentChatsToRetryRead.has(trackingKey) &&
              (page.readState?.unreadCount ?? 0) > 0 &&
              isAgentChatReadable(agentId)
            ) {
              const latestIncomingMessage = latestIncomingConversationMessage(page.messages);
              if (latestIncomingMessage) autoMarkAgentMessageRead(agentId, latestIncomingMessage.id);
            }
          })
          .catch(() => {
            if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== pageRequest) return;
            updateConversation(agentId, (conversation) => {
              conversation.loading = false;
              conversation.loadError = currentText().t("server.connection.conversationFailed");
            });
            if (agentChatsToMarkRead.delete(trackingKey)) markLatestVisibleAgentMessageRead(agentId, serverId);
          });
      },
    );

    function prefetchedPageIsCurrent(page: ConversationPage): boolean {
      const conversation = conversations[page.agentId];
      if (conversation?.loaded) return false;
      const pageMessageIds = new Set(page.messages.map((message) => message.id));
      if (conversation?.messages.some((message) => !pageMessageIds.has(message.id))) return false;
      const pageTurnId = completedTurnByAgent.get(page.agentId) === page.activeTurnId ? null : page.activeTurnId;
      if ((activeTurns()[page.agentId] ?? null) !== pageTurnId) return false;
      const read = conversation?.read;
      return (
        !read ||
        !page.readState ||
        (read.unreadCount === page.readState.unreadCount &&
          read.firstUnreadMessageId === page.readState.firstUnreadMessageId)
      );
    }

    const prefetchKey = createMemo(() => {
      const server = activeServer();
      const agentId = activeAgentId();
      const account = signedInAccount();
      if (!account || server?.kind !== "remote" || server.state !== "online" || !agentId) return "";
      if (conversations[agentId]?.loaded !== true) return "";
      const ids = agentList()
        .map((agent) => agent.id)
        .join("\0");
      return `${account}\n${server.id}\n${agentId}\n${ids}`;
    });

    createEffect(prefetchKey, (key) => {
      if (!key || typeof window.requestIdleCallback !== "function") return;
      const [, serverId, agentId, ids = ""] = key.split("\n");
      if (!serverId || !agentId || !ids) return;

      const listedIds = ids.split("\0");
      const listed = new Set(listedIds);
      for (const cachedId of prefetchedConversationPages.keys()) {
        if (!listed.has(cachedId) || untrack(() => conversations[cachedId]?.loaded))
          prefetchedConversationPages.delete(cachedId);
      }
      const freeSlots = Math.max(0, 20 - prefetchedConversationPages.size);
      if (freeSlots === 0) return;

      const candidates = listedIds
        .filter(
          (id) => id !== agentId && !prefetchedConversationPages.has(id) && !untrack(() => conversations[id]?.loaded),
        )
        .slice(0, freeSlots);
      let stopped = false;
      let idle: number | undefined;

      function next(): void {
        const id = candidates.shift();
        if (stopped || !id) return;
        idle = window.requestIdleCallback(() => {
          const request = conversationPageRequests.get(id);
          void conversationPort()
            .agent.readConversationPage({ agentId: id, anchor: { type: "latest" }, limit: 24 }, serverId)
            .then((page) => {
              if (
                !stopped &&
                scopeIsCurrent() &&
                conversationPageRequests.get(id) === request &&
                !untrack(() => conversations[id]?.loaded)
              ) {
                prefetchedConversationPages.set(id, page);
              }
            })
            .catch(() => undefined)
            .finally(next);
        });
      }

      next();
      return () => {
        stopped = true;
        if (idle !== undefined) window.cancelIdleCallback(idle);
      };
    });

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
      prefetchedConversationPages.delete(agentId);
      agentChatsRetriedOnOpen.delete(agentId);
    }

    function applyRuntimeMessages(messages: AgentRuntimeSnapshot["latestMessages"]): void {
      setConversations((current) => {
        const pending = messages.filter((message) => {
          if (current[message.agentId]?.windowMode === "around") return false;
          const loaded = current[message.agentId]?.messages;
          if (!loaded?.some((candidate) => candidate.id === message.id)) return true;
          return message.agentId !== activeAgentId() && loaded.length > LATEST_PAGE_SIZE;
        });
        if (pending.length === 0) return;
        const agentIds = new Set(pending.map((message) => message.agentId));
        const currentMessages: Record<string, ConversationState["messages"]> = {};
        for (const agentId of agentIds) {
          const loaded = current[agentId]?.messages;
          if (loaded) currentMessages[agentId] = loaded;
        }
        const next = appendLatestRuntimeMessages(currentMessages, pending);
        for (const message of pending) {
          if (currentMessages[message.agentId]?.some((candidate) => candidate.id === message.id)) continue;
          if (!next[message.agentId]?.some((candidate) => candidate.id === message.id)) continue;
          rawAgentMessageBodies.set(agentMessageKey(message.agentId, message.id), "");
        }
        for (const agentId of agentIds) {
          current[agentId] ??= { messages: [] };
          current[agentId].messages = next[agentId] ?? [];
          if (agentId !== activeAgentId()) trimToLatestPage(current[agentId]);
        }
      });
    }

    function applyConversationReads(reads: Record<string, ConversationReadState>): void {
      setConversations((current) => {
        for (const [agentId, conversation] of Object.entries(current)) {
          const read = reads[agentId];
          if (read === undefined) delete conversation.read;
          else conversation.read = read;
        }
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
      if (explicit) heldUnreadAgentChats.delete(trackingKey);
      else if (heldUnreadAgentChats.has(trackingKey)) return;
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
      flushConversationDeltas();
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
      cancelConversationFrame ??= onNextFrame(applyPendingConversations);
    }

    function applyPendingConversations(): void {
      cancelConversationFrame?.();
      cancelConversationFrame = undefined;
      flushConversationDeltas();
      const snapshots = [...pendingConversationSnapshots.values()];
      pendingConversationSnapshots.clear();
      for (const pendingSnapshot of snapshots) {
        applyConversation(pendingSnapshot, isAgentChatReadable(pendingSnapshot.agentId));
      }
    }

    function isAgentChatOpen(agentId: string): boolean {
      return (
        !agentSetupOpen() &&
        !activeDirectMemberId() &&
        !channels.state.selectedId &&
        !windowPage.conversationCovered() &&
        activeAgent()?.id === agentId
      );
    }

    function isAgentChatReadable(agentId: string): boolean {
      return (
        appFocused() &&
        isAgentChatOpen(agentId) &&
        !heldUnreadAgentChats.has(agentConversationKey(activeServerId(), agentId))
      );
    }

    function markLatestVisibleAgentMessageRead(agentId: string, serverId: string): void {
      flushConversationDeltas();
      const latestMessageId = latestVisibleAgentMessageId(conversations[agentId]?.messages);
      if (!latestMessageId) return;
      if (autoReadAgentMessages.get(agentConversationKey(serverId, agentId))?.messageId === latestMessageId) return;
      void markAgentMessagesRead(agentId, latestMessageId, serverId).catch((error) =>
        reportAutomaticReadFailure(agentId, error, serverId),
      );
    }

    function reportAutomaticReadFailure(agentId: string, error: unknown, serverId: string): void {
      if (isConnectionDrop(error)) {
        agentChatsToRetryRead.add(agentConversationKey(serverId, agentId));
        return;
      }
      appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
    }

    function refreshAgentReadStateAfterFailure(
      agentId: string,
      messageId: string,
      serverId: string,
      minimumRevision: number,
      fallbackState: ConversationReadState | null,
    ): void {
      flushConversationDeltas();
      const trackingKey = agentConversationKey(serverId, agentId);
      const conversationAtStart = conversations[agentId];
      const applyFallback = () => {
        if (!scopeIsCurrent() || autoReadAgentMessages.has(trackingKey) || !fallbackState) return;
        const latest = conversations[agentId]?.read;
        if (latest?.unreadCount === 0 && latest.throughMessageId === messageId) {
          applyConversationReadState(agentId, fallbackState);
        }
      };
      void conversationPort()
        .agent.readConversationPage({ agentId, anchor: { type: "latest" }, limit: 1 }, serverId)
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
      flushConversationDeltas();
      const serverId = activeServerId();
      const trackingKey = agentConversationKey(serverId, agentId);
      if (heldUnreadAgentChats.has(trackingKey)) return;
      const decision = decideAgentAutoRead({
        messageId,
        current: conversations[agentId]?.read,
        tracked: autoReadAgentMessages.get(trackingKey),
        optimisticallyClearUnread,
        explicitlyOpened: explicitlyOpenedAgentChatId() === agentId,
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
        reportAutomaticReadFailure(agentId, error, serverId);
      });
    }

    function applyConversationDelta(event: ConversationDeltaEvent) {
      queuedDeltas.push(event);
      cancelDeltaFrame ??= onNextFrame(flushConversationDeltas);
    }

    function deltaApplies(event: ConversationDeltaEvent): boolean {
      if (event.revision <= (conversations[event.agentId]?.revision ?? -1)) return false;
      const pendingSnapshot = pendingConversationSnapshots.get(event.agentId);
      return !pendingSnapshot || event.revision > pendingSnapshot.revision;
    }

    function flushConversationDeltas(): void {
      cancelDeltaFrame?.();
      cancelDeltaFrame = undefined;
      if (queuedDeltas.length === 0) return;
      const events = queuedDeltas;
      queuedDeltas = [];
      let joined: ConversationDeltaEvent | undefined;
      for (const event of events) {
        if (
          joined &&
          joined.agentId === event.agentId &&
          joined.messageId === event.messageId &&
          event.revision > joined.revision
        ) {
          joined = { ...joined, revision: event.revision, delta: joined.delta + event.delta };
          continue;
        }
        if (joined) applyDeltaNow(joined);
        joined = deltaApplies(event) ? event : undefined;
      }
      if (joined) applyDeltaNow(joined);
    }

    function applyDeltaNow(event: ConversationDeltaEvent) {
      rendererPerfCount("conversation.applyDelta");
      if (event.revision <= (conversations[event.agentId]?.revision ?? -1)) return;
      const pendingSnapshot = pendingConversationSnapshots.get(event.agentId);
      if (pendingSnapshot) {
        if (event.revision <= pendingSnapshot.revision) return;
        pendingConversationSnapshots.delete(event.agentId);
        applyConversation(pendingSnapshot, isAgentChatReadable(event.agentId));
      }
      const messageKey = agentMessageKey(event.agentId, event.messageId);
      const animate = conversations[event.agentId]?.loaded === true;
      let appended = false;
      updateConversation(event.agentId, (conversation) => {
        conversation.revision = event.revision;
        if (conversation.loaded !== true) conversation.loaded = true;
        const messages = conversation.messages;
        const existing = messages.findLast((message) => message.id === event.messageId);
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
        const cleanedBody = cleanAgentMessageText(rawBody);
        rendererPerfCount("conversation.cleanTextChars", rawBody.length);
        if (existing) {
          updateStored(existing, {
            ...existing,
            body: cleanedBody,
            streaming: true,
          });
          return;
        }
        if (thinking && thinkingItemIndex >= 0) {
          const items = [...(thinking.items ?? [])];
          items[thinkingItemIndex] = cleanedBody;
          updateStored(thinking, { ...thinking, items, streaming: true });
          return;
        }
        const message = createStoredMessage({
          id: event.messageId,
          turnId: event.turnId,
          author: "agent",
          body: cleanedBody,
          time: formatMessageTime(event.createdAt),
          createdAt: event.createdAt,
          streaming: true,
          animate,
          kind: "text",
        });
        appended = true;
        conversation.messages = [...messages, message];
        if (event.agentId !== activeAgentId()) trimToLatestPage(conversation);
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
    }

    function applyConversation(snapshot: ConversationSnapshot, markNewMessagesRead = false) {
      const agentId = snapshot.agentId;
      if (snapshot.revision < (conversations[agentId]?.revision ?? -1)) return;
      const initialLoad = conversations[agentId]?.loaded !== true;
      const inactive = agentId !== activeAgentId();
      const windowMode = conversations[agentId]?.windowMode ?? "latest";
      const sourceMessages =
        inactive && windowMode === "latest" && snapshot.messages.length > INACTIVE_SNAPSHOT_TAIL
          ? snapshot.messages.slice(-INACTIVE_SNAPSHOT_TAIL)
          : snapshot.messages;
      const activeTurnId = completedTurnByAgent.get(agentId) === snapshot.activeTurnId ? null : snapshot.activeTurnId;
      updateConversation(agentId, (conversation) => {
        conversation.revision = snapshot.revision;
        conversation.loaded = true;
        const previous = conversation.messages;
        const previousById = new Map(previous.map((message) => [message.id, message]));
        const allMappedMessages = toAgentMessages(sourceMessages, snapshot.agentId);
        const mappedMessages = retainThinkingMessages(
          previous,
          windowedSnapshotMessages(previous, allMappedMessages, {
            mode: windowMode,
            capped:
              snapshot.messages.length >= CONVERSATION_SNAPSHOT_MESSAGE_LIMIT || conversation.page?.hasOlder === true,
          }),
          activeTurnId,
        );
        const next = mappedMessages.map((mapped) => {
          const existing = previousById.get(mapped.id);
          if (!existing) return createStoredMessage({ ...mapped, animate: !initialLoad });
          if (!agentMessagesEqual(existing, mapped))
            updateStored(existing, existing.animate === undefined ? mapped : { ...mapped, animate: existing.animate });
          return existing;
        });
        if (previous.length === next.length && previous.every((message, index) => message === next[index])) {
          return;
        }
        conversation.messages = next;
        if (!inactive) return;
        trimToLatestPage(conversation);
        if (sourceMessages !== snapshot.messages) conversation.page = { hasOlder: true, olderCursor: null };
      });
      const presentedRequestKey = presentedPromptResolutions()[agentId];
      const promptKey = ownChatAttentionKey(agentId);
      const pendingPrompt = pendingPrompts()[promptKey];
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
        setPendingPrompts((current) => ({ ...current, [promptKey]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
      } else if (
        resolvedPendingPrompt &&
        (activeAgent()?.id !== agentId || !submittedRequestKey || submittedRequestKey !== pendingRequestKey)
      ) {
        setPendingPrompts((current) => ({ ...current, [promptKey]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
      }
      setActiveTurns((current) =>
        current[agentId] === activeTurnId ? current : { ...current, [agentId]: activeTurnId },
      );
      setTurnProgress((current) => {
        const progress = current[agentId];
        if (progress && progress.turnId !== snapshot.activeTurnId) delete current[agentId];
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

    function keepOlderHistoryPlace(page: ConversationPage): void {
      const conversation = conversations[page.agentId];
      if (!conversation || !lacksOlderCursor(conversation.page)) return;
      const mapped = toAgentMessages(page.messages, page.agentId);
      const first = conversation.messages[0];
      const start = first ? mapped.findIndex((message) => message.id === first.id) : -1;
      if (start === -1 && !conversation.messages.some((message) => message.id === mapped[0]?.id)) return;
      const older = mapped
        .slice(0, Math.max(start, 0))
        .map((message) => createStoredMessage({ ...message, animate: false }));
      updateConversation(page.agentId, (current) => {
        current.messages = mergeConversationPage(current.messages, older, "older");
        current.references = { ...current.references, ...pageReferences(page) };
        current.missingReferences = { ...current.missingReferences, ...missingReplyOriginals(page) };
        current.page = page.pageInfo;
      });
    }

    function applyConversationPage(
      page: ConversationPage,
      merge: "replace" | "older" | "latest",
      windowMode?: "latest" | "around",
    ): boolean {
      flushConversationDeltas();
      if (page.revision < (conversations[page.agentId]?.revision ?? -1)) {
        if (merge !== "older") keepOlderHistoryPlace(page);
        return false;
      }
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
          if (!agentMessagesEqual(stored, message))
            updateStored(stored, stored.animate === undefined ? message : { ...message, animate: stored.animate });
          return stored;
        });
        const pageItemIds = new Set(page.messages.map((message) => message.id));
        const mappedIds = new Set(pageMessages.map((message) => message.id));
        const trimmed = lacksOlderCursor(conversation.page);
        const tail = merge === "latest" && page.pageInfo.hasOlder && !trimmed;
        const keepsWindow = tail && conversation.windowMode === "around";
        const apart = tail && !keepsWindow && !currentMessages.some((message) => mappedIds.has(message.id));
        const kept = currentMessages.filter((message) => mappedIds.has(message.id) || !pageItemIds.has(message.id));
        conversation.messages = keepsWindow
          ? windowedSnapshotMessages(currentMessages, pageMessages, { mode: "around", capped: true }).filter(
              (message) => mappedIds.has(message.id) || !pageItemIds.has(message.id),
            )
          : mergeConversationPage(kept, pageMessages, apart ? "replace" : merge);
        const first = conversation.messages[0];
        const keepsOlder = keepsWindow || (tail && first !== undefined && !mappedIds.has(first.id));
        conversation.references = {
          ...(merge === "replace" ? {} : conversation.references),
          ...pageReferences(page),
        };
        conversation.missingReferences = {
          ...(merge === "replace" ? {} : conversation.missingReferences),
          ...missingReplyOriginals(page),
        };
        if (!keepsOlder) conversation.page = page.pageInfo;
        if (windowMode && !keepsWindow) conversation.windowMode = windowMode;
        conversation.revision = page.revision;
        conversation.loaded = true;
      });
      if (merge === "latest")
        for (const messageId of openExchangesOutside(conversations[page.agentId]?.messages ?? [], page.messages))
          refreshOpenExchange(page.agentId, messageId);
      const pageActiveTurnId = completedTurnByAgent.get(page.agentId) === page.activeTurnId ? null : page.activeTurnId;
      setActiveTurns((current) =>
        current[page.agentId] === pageActiveTurnId ? current : { ...current, [page.agentId]: pageActiveTurnId },
      );
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

    const openExchangeReads = new Map<string, { again: boolean }>();

    function refreshOpenExchange(agentId: string, messageId: string): void {
      const key = agentMessageKey(agentId, messageId);
      const running = openExchangeReads.get(key);
      if (running) {
        running.again = true;
        return;
      }
      const read = { again: true };
      openExchangeReads.set(key, read);
      void (async () => {
        try {
          while (read.again && scopeIsCurrent()) {
            read.again = false;
            const page = await conversationPort().agent.readConversationPage({
              agentId,
              anchor: { type: "around", messageId },
              limit: 1,
            });
            const message = page.messages.find((candidate) => candidate.id === messageId);
            if (!scopeIsCurrent() || !message) return;
            const fresh = toAgentMessage(message, agentId);
            updateConversation(agentId, (conversation) => {
              const stored = conversation.messages.find((candidate) => candidate.id === messageId);
              if (stored && page.revision >= (conversation.revision ?? -1) && !agentMessagesEqual(stored, fresh))
                updateStored(stored, stored.animate === undefined ? fresh : { ...fresh, animate: stored.animate });
            });
          }
        } finally {
          openExchangeReads.delete(key);
        }
      })().catch(() => undefined);
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
        const page = await conversationPort().agent.readConversationPage({
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
          const text = currentText();
          conversation.olderError = text.errorMessage(error, text.t("chat.history.olderFailed"));
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
        const page = await conversationPort().agent.searchConversationMessages({ query, agentId, limit: 100 });
        analytics.track("search_action", { scope: "agent", result: "succeeded", result_count: page.total });
        return { messageIds: page.results.map((result) => result.message.id), total: page.total };
      } catch (error) {
        analytics.track("search_action", { scope: "agent", result: "failed", failure_code: "search_failed" });
        throw error;
      }
    }

    function searchAgentThreadMessages(agentId: string, query: string): Promise<ComposerThreadMessageMatch[]> {
      return collectThreadMessageMatches((cursor) =>
        conversationPort().agent.searchConversationMessages({
          query,
          agentId,
          ...(cursor ? { cursor } : {}),
          limit: THREAD_MESSAGE_SEARCH_PAGE_LIMIT,
          includeSideThreads: true,
        }),
      );
    }

    function pruneInactiveAgentHistory(agentId: string): void {
      flushConversationDeltas();
      const messages = conversations[agentId]?.messages;
      if (!messages || messages.length <= LATEST_PAGE_SIZE) return;
      updateConversation(agentId, trimToLatestPage);
    }

    async function loadLatestAgentMessages(agentId: string): Promise<void> {
      const request = (conversationPageRequests.get(agentId) ?? 0) + 1;
      conversationPageRequests.set(agentId, request);
      const page = await conversationPort().agent.readConversationPage({
        agentId,
        anchor: { type: "latest" },
        limit: latestPageSize(agentId, activeServer()?.kind === "remote"),
      });
      if (!scopeIsCurrent() || conversationPageRequests.get(agentId) !== request) return;
      applyConversationPage(page, "replace", "latest");
    }

    async function loadAgentMessagePage(agentId: string, messageId: string): Promise<ConversationPage | null> {
      const request = (conversationPageRequests.get(agentId) ?? 0) + 1;
      conversationPageRequests.set(agentId, request);
      const page = await conversationPort().agent.readConversationPage({
        agentId,
        anchor: { type: "around", messageId },
        limit: 50,
      });
      if (conversationPageRequests.get(agentId) !== request || !scopeIsCurrent()) return null;
      if (!page.messages.some((message) => message.id === messageId)) {
        throw new Error(currentText().t("chat.messageUnavailable"));
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
      clientMessageId?: string,
      voiceRecordingDraftId?: string,
    ): Promise<SendMessageResult> {
      const agentId = target?.agentId ?? activeAgent()?.id;
      const serverId = target?.serverId ?? activeServerId();
      if (!agentId || (!body.trim() && attachmentDraftIds.length === 0))
        return { error: currentText().t("chat.errorStatus.send") };
      return sendMessageToAgent(
        agentId,
        body,
        attachmentDraftIds,
        replyToMessageId,
        serverId,
        clientMessageId,
        voiceRecordingDraftId,
      );
    }

    async function sendMessageToAgent(
      agentId: string,
      body: string,
      attachmentDraftIds: string[],
      replyToMessageId: string | null = null,
      serverId = activeServerId(),
      clientMessageId?: string,
      voiceRecordingDraftId?: string,
    ): Promise<SendMessageResult> {
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      const attachmentKinds = takeAttachmentKinds(attachmentDraftIds);
      try {
        const input = {
          agentId,
          text: body.trim(),
          attachmentDraftIds,
          ...(replyToMessageId ? { replyToMessageId } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
          ...(voiceRecordingDraftId ? { voiceRecordingDraftId } : {}),
        };
        noteAgentRequest(serverId, agentId);
        const receipt = await conversationPort().agent.sendMessage(input, serverId);
        const errorKey = agentConversationKey(serverId, agentId);
        setUiErrors((current) => ({ ...current, [errorKey]: [] }));
        analytics.track("message_send", {
          ...(properties ?? {}),
          channel: "agent",
          attachment_count: attachmentDraftIds.length,
          attachment_kinds: attachmentKinds,
          is_reply: replyToMessageId !== null,
          result: "succeeded",
          delivery_count: receipt.deliveries.length,
        });
        noteAgentMessageSent();
        noteSocialFollowMessageSent();
        const messageId = receipt.deliveries[0]?.id ?? receipt.messageId;
        markAgentMessagesRead(agentId, messageId, serverId).catch((error: unknown) => {
          reportAutomaticReadFailure(agentId, error, serverId);
        });
        return { messageId };
      } catch (error) {
        analytics.track("message_send", {
          ...(properties ?? {}),
          channel: "agent",
          attachment_count: attachmentDraftIds.length,
          attachment_kinds: attachmentKinds,
          is_reply: replyToMessageId !== null,
          result: "failed",
          failure_code: "send_failed",
        });
        const { t, errorMessage } = currentText();
        return { error: errorMessage(error, t("chat.errorStatus.send")) };
      }
    }

    async function markAgentMessagesRead(
      agentId = activeAgent()?.id,
      throughMessageId?: string | null,
      serverId = activeServerId(),
      onSuccess?: (state: ConversationReadState) => void,
    ): Promise<void> {
      if (!agentId || !scopeIsCurrent()) return;
      flushConversationDeltas();
      const requestKey = agentConversationKey(serverId, agentId);
      heldUnreadAgentChats.delete(requestKey);
      const conversationAtStart = conversations[agentId];
      const visibleMessageIdAtStart = latestVisibleAgentMessageId(conversations[agentId]?.messages);
      const boundary =
        throughMessageId ??
        visibleMessageIdAtStart ??
        conversations[agentId]?.messages
          ?.filter((message) => !message.id.startsWith("thinking:") && !message.id.startsWith("ui-"))
          .at(-1)?.id ??
        null;
      const previousOperation = conversationReadOperations.get(requestKey) ?? Promise.resolve();
      const operation: Promise<void> = previousOperation
        .catch(() => undefined)
        .then(async () => {
          const state: ConversationReadState = await conversationPort().agent.markConversationRead(
            {
              agentId,
              throughMessageId: boundary,
            },
            serverId,
          );
          agentChatsToRetryRead.delete(requestKey);
          clearUiErrors(currentText().t("chat.errorStatus.readState"), requestKey);
          flushConversationDeltas();
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
              flushConversationDeltas();
              const latestVisibleMessageId = latestVisibleAgentMessageId(conversations[agentId]?.messages);
              if (
                scopeIsCurrent() &&
                isAgentChatReadable(agentId) &&
                latestVisibleMessageId &&
                latestVisibleMessageId !== boundary &&
                latestVisibleMessageId !== visibleMessageIdAtStart
              ) {
                void markAgentMessagesRead(agentId, latestVisibleMessageId, serverId).catch((error) =>
                  reportAutomaticReadFailure(agentId, error, serverId),
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

    async function markAgentMessagesUnread(
      agentId: string,
      fromMessageId: string,
      serverId = activeServerId(),
    ): Promise<void> {
      const requestKey = agentConversationKey(serverId, agentId);
      heldUnreadAgentChats.add(requestKey);
      const operation: Promise<void> = (conversationReadOperations.get(requestKey) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          const state = await conversationPort().agent.markConversationUnread({ agentId, fromMessageId }, serverId);
          autoReadAgentMessages.delete(requestKey);
          if (scopeIsCurrent()) applyConversationReadState(agentId, state);
        });
      conversationReadOperations.set(requestKey, operation);
      try {
        await operation;
      } catch (error) {
        heldUnreadAgentChats.delete(requestKey);
        appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
      } finally {
        if (conversationReadOperations.get(requestKey) === operation) conversationReadOperations.delete(requestKey);
      }
    }

    const messagePins: ConversationMessagePins = {
      list: (agentId) => conversationPort().agent.listPinnedMessages(agentId, activeServerId()),
      set: (input) => conversationPort().agent.setMessagePinned(input, activeServerId()),
      subscribe: (agentId, changed) => {
        const serverId = activeServerId();
        return conversationPort().agent.onScopedEvent((scoped) => {
          if (
            scoped.serverId === serverId &&
            scoped.event.type === "message-pins-changed" &&
            scoped.event.agentId === agentId
          )
            changed();
        });
      },
    };

    async function deleteAgentMessage(
      agentId: string,
      messageId: string,
      taskId?: string,
      serverId = activeServerId(),
    ): Promise<void> {
      await conversationPort().agent.deleteConversationMessage(
        taskId === undefined ? { agentId, messageId } : { agentId, messageId, taskId },
        serverId,
      );
      if (taskId !== undefined || !scopeIsCurrent() || !conversations[agentId]) return;
      flushConversationDeltas();
      rawAgentMessageBodies.delete(agentMessageKey(agentId, messageId));
      updateConversation(agentId, (conversation) => {
        conversation.messages = conversation.messages.filter((message) => message.id !== messageId);
        conversation.references = Object.fromEntries(
          Object.entries(conversation.references ?? {}).filter(([id]) => id !== messageId),
        );
        conversation.missingReferences = { ...conversation.missingReferences, [messageId]: true };
      });
    }

    async function markAgentChatRead(agentId: string, serverId = activeServerId()): Promise<void> {
      const reportFailure = (error: unknown) =>
        appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
      const readOwnChat = async () => {
        const page = await conversationPort().agent.readConversationPage(
          { agentId, anchor: { type: "latest" }, limit: 1 },
          serverId,
        );
        const latestMessageId = page.messages.at(-1)?.id;
        if (latestMessageId) await markAgentMessagesRead(agentId, latestMessageId, serverId);
      };
      await Promise.all([
        (unreadReplies()[agentId] ?? 0) > 0 ? readOwnChat().catch(reportFailure) : undefined,
        (agentTasks.unreadTotals()[agentId] ?? 0) > 0
          ? agentTasks.markAllTasksRead(agentId).catch(reportFailure)
          : undefined,
      ]);
    }

    async function markAllAgentMessagesRead(): Promise<void> {
      const serverId = activeServerId();
      await Promise.all(agentList().map((agent) => markAgentChatRead(agent.id, serverId)));
    }

    async function markAgentChatUnread(agentId: string, serverId = activeServerId()): Promise<void> {
      try {
        const page = await conversationPort().agent.readConversationPage(
          { agentId, anchor: { type: "latest" }, limit: LATEST_PAGE_SIZE },
          serverId,
        );
        const latestReply = latestIncomingConversationMessage(page.messages);
        if (latestReply) await markAgentMessagesUnread(agentId, latestReply.id, serverId);
      } catch (error) {
        appendUiError(agentId, error, currentText().t("chat.errorStatus.readState"), serverId);
      }
    }

    function presentPromptResolution(agentId: string, turnId: string, requestId: string | number): void {
      const requestKey = promptRequestKey(turnId, requestId);
      if (!requestKey) return;
      const promptKey = ownChatAttentionKey(agentId);
      const currentPrompt = pendingPrompts()[promptKey];
      if (
        currentPrompt?.type !== "prompt" ||
        promptRequestKey(currentPrompt.turnId, currentPrompt.requestId) !== requestKey
      ) {
        return;
      }
      flushConversationDeltas();
      const persisted = (conversations[agentId]?.messages ?? []).some(
        (message) => messagePromptRequestKey(message) === requestKey && message.questionPrompt?.resolution !== null,
      );
      if (persisted) {
        setPendingPrompts((current) => ({ ...current, [promptKey]: undefined }));
        setPresentedPromptResolutions((current) => ({ ...current, [agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
        return;
      }
      setPresentedPromptResolutions((current) => ({ ...current, [agentId]: requestKey }));
    }

    document.addEventListener("visibilitychange", applyPendingConversations);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", applyPendingConversations);
      cancelConversationFrame?.();
      cancelDeltaFrame?.();
    });

    return {
      conversations,
      retryConversation: () => setAgentChatOpenRevision((current) => current + 1),
      unreadReplies,
      agentUnreadReplies,
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
      flushConversationDeltas,
      applyConversationPage,
      loadOlderAgentMessages,
      loadLatestAgentMessages,
      loadAgentMessagePage,
      pruneInactiveAgentHistory,
      markReplyCompleted,
      clearRecentReply,
      searchAgentMessages,
      searchAgentThreadMessages,
      sendMessage,
      markAgentMessagesRead,
      markAgentMessagesUnread,
      deleteAgentMessage,
      messagePins,
      markAgentChatRead,
      markAgentChatUnread,
      markAllAgentMessagesRead,
      presentPromptResolution,
      setTeamTyping: chatWindow ? () => undefined : notifyTeamTyping,
    };
  },
});

export const ConversationProvider = Conversation.provider;
export const useConversation = Conversation.use;
