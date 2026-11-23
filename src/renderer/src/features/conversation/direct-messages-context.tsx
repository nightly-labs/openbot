import type {
  DirectConversationPage,
  DirectConversationSnapshot,
  DirectMessage,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingRealtimeEvent,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { usePlatform } from "../../platform";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "../servers/servers-context";
import { usePresence } from "../team/team-context";
import { useWindowPage } from "../window/window-page-context";
import { conversationPort } from "./conversation-port";
import { preserveKnownDirectUnread } from "./conversation-read-state";

function recoveredDirectConversation(
  page: DirectConversationPage,
  cached: DirectConversationSnapshot | undefined,
  currentMemberId: string | undefined,
): DirectConversationPage {
  if (!cached || cached.threadId !== page.threadId) return page;
  const newer = cached.messages.filter((message) => message.sequence > page.revision);
  const messages = [...page.messages, ...newer];
  let readState = page.readState;
  if (cached.readState && (!readState || cached.readState.throughSequence > readState.throughSequence)) {
    readState = preserveKnownDirectUnread(
      cached.readState,
      cached.readState.throughSequence,
      messages,
      currentMemberId,
    );
  } else if (readState) {
    const throughSequence = readState.throughSequence;
    const unread = newer.filter(
      (message) => message.senderMemberId !== currentMemberId && message.sequence > throughSequence,
    );
    readState = {
      ...readState,
      unreadCount: readState.unreadCount + unread.length,
      firstUnreadMessageId: readState.firstUnreadMessageId ?? unread[0]?.id ?? null,
    };
  }
  return {
    ...page,
    messages,
    revision: Math.max(page.revision, cached.revision),
    ...(readState === undefined ? {} : { readState }),
  };
}

const DirectMessages = createSimpleContext({
  name: "Direct messages",
  init: () => {
    const { appFocused, peopleEnabled } = usePlatform();
    const windowPage = useWindowPage();
    const conversationVisible = () => appFocused() && !windowPage.conversationCovered();
    const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
    const { currentTeamMember, directPeople } = usePresence();
    const scopeIsCurrent = createScopeGuard();

    const [directThreads, setDirectThreads] = createSignal<DirectThreadSummary[]>([]);
    const [directConversations, setDirectConversations] = createSignal<Record<string, DirectConversationSnapshot>>({});
    const [activeDirectMemberId, setActiveDirectMemberId] = createSignal<string | null>(null);
    const [directConversationLoading, setDirectConversationLoading] = createSignal(false);
    const [directConversationError, setDirectConversationError] = createSignal<string | null>(null);
    const [directConversationPages, setDirectConversationPages] = createSignal<
      Record<string, DirectConversationPage["pageInfo"]>
    >({});
    const [directOlderLoading, setDirectOlderLoading] = createSignal<Record<string, boolean>>({});
    const [directOlderErrors, setDirectOlderErrors] = createSignal<Record<string, string | null>>({});
    const [directTypingMemberIds, setDirectTypingMemberIds] = createSignal<Set<string>>(new Set());
    const directConversationReadOperations = new Map<string, Promise<void>>();
    let directConversationRequest = 0;
    let directThreadsRequest = 0;

    const activeDirectMember = createMemo(() =>
      peopleEnabled ? directPeople().find((member) => member.id === activeDirectMemberId()) : undefined,
    );

    async function refreshDirectThreads(): Promise<void> {
      const request = ++directThreadsRequest;
      if (!scopeIsCurrent()) return;
      if (!currentTeamMember() || !activeServerSupportsCapability("direct-messages")) {
        setDirectThreads([]);
        return;
      }
      try {
        const threads = await conversationPort().servers.listDirectThreads();
        if (!scopeIsCurrent() || request !== directThreadsRequest) return;
        setDirectThreads(threads);
      } catch {}
    }

    function pruneInactiveDirectHistory(memberId: string): void {
      const snapshot = directConversations()[memberId];
      if (!snapshot || snapshot.messages.length <= 50) return;
      setDirectConversations((current) => {
        const conversation = current[memberId];
        if (!conversation || conversation.messages.length <= 50) return current;
        return {
          ...current,
          [memberId]: { ...conversation, messages: conversation.messages.slice(-50) },
        };
      });
      setDirectConversationPages((current) => ({
        ...current,
        [memberId]: { hasOlder: true, olderCursor: null },
      }));
    }

    async function openDirectConversation(memberId: string): Promise<void> {
      const previousMemberId = activeDirectMemberId();
      if (previousMemberId && previousMemberId !== memberId) {
        pruneInactiveDirectHistory(previousMemberId);
        void conversationPort()
          .servers.setDirectTyping({ memberId: previousMemberId, typing: false })
          .catch(() => undefined);
      }
      setActiveDirectMemberId(memberId);
      await loadDirectConversation(memberId, false);
    }

    async function refreshDirectConversation(): Promise<void> {
      const memberId = activeDirectMemberId();
      if (!memberId || !scopeIsCurrent() || !activeServerSupportsCapability("direct-messages")) return;
      await loadDirectConversation(memberId, true);
    }

    async function loadDirectConversation(memberId: string, retainCached: boolean): Promise<void> {
      const hasCached = retainCached && Boolean(directConversations()[memberId]);
      setDirectConversationLoading(!hasCached);
      setDirectConversationError(null);
      const request = ++directConversationRequest;
      try {
        const page = await conversationPort().servers.readDirectConversationPage({
          memberId,
          anchor: { type: "latest" },
          limit: 50,
        });
        if (!scopeIsCurrent() || request !== directConversationRequest) return;
        const snapshot = retainCached
          ? recoveredDirectConversation(page, directConversations()[memberId], currentTeamMember()?.id)
          : page;
        setDirectConversations((current) => ({
          ...current,
          [memberId]: snapshot,
        }));
        setDirectConversationPages((current) => ({ ...current, [memberId]: snapshot.pageInfo }));
        if (conversationVisible() && (snapshot.readState?.unreadCount ?? 0) > 0) {
          void markDirectMessagesRead(memberId, snapshot.messages.at(-1)?.sequence).catch(() => undefined);
        }
      } catch (error) {
        if (!scopeIsCurrent() || request !== directConversationRequest) return;
        if (!hasCached) {
          const text = currentText();
          setDirectConversationError(text.errorMessage(error, text.t("conversation.direct.loadFailed")));
        }
      } finally {
        if (scopeIsCurrent() && request === directConversationRequest) setDirectConversationLoading(false);
      }
    }

    async function loadOlderDirectMessages(memberId = activeDirectMemberId()): Promise<void> {
      if (!memberId || directOlderLoading()[memberId]) return;
      const pageInfo = directConversationPages()[memberId];
      if (!pageInfo?.hasOlder || !pageInfo.olderCursor) return;
      const cursor = pageInfo.olderCursor;
      const request = directConversationRequest;
      setDirectOlderLoading((current) => ({ ...current, [memberId]: true }));
      setDirectOlderErrors((current) => ({ ...current, [memberId]: null }));
      try {
        const page = await conversationPort().servers.readDirectConversationPage({
          memberId,
          anchor: { type: "before", cursor },
          limit: 50,
        });
        if (request !== directConversationRequest || activeDirectMemberId() !== memberId) return;
        if (directConversationPages()[memberId]?.olderCursor !== cursor) return;
        setDirectConversations((current) => {
          const existing = current[memberId];
          if (!existing) return current;
          const ids = new Set(page.messages.map((message) => message.id));
          const readState = page.readState ?? existing.readState;
          return {
            ...current,
            [memberId]: {
              ...existing,
              messages: [...page.messages, ...existing.messages.filter((message) => !ids.has(message.id))],
              revision: Math.max(existing.revision, page.revision),
              ...(readState === undefined ? {} : { readState }),
            },
          };
        });
        setDirectConversationPages((current) => ({ ...current, [memberId]: page.pageInfo }));
      } catch (error) {
        const text = currentText();
        setDirectOlderErrors((current) => ({
          ...current,
          [memberId]: text.errorMessage(error, text.t("conversation.direct.olderFailed")),
        }));
      } finally {
        setDirectOlderLoading((current) => ({ ...current, [memberId]: false }));
      }
    }

    async function openDirectMessage(memberId: string, messageId: string): Promise<void> {
      const request = ++directConversationRequest;
      try {
        const page = await conversationPort().servers.readDirectConversationPage({
          memberId,
          anchor: { type: "around", messageId },
          limit: 50,
        });
        if (request !== directConversationRequest || activeDirectMemberId() !== memberId) return;
        setDirectConversations((current) => ({ ...current, [memberId]: page }));
        setDirectConversationPages((current) => ({ ...current, [memberId]: page.pageInfo }));
      } catch (error) {
        if (request !== directConversationRequest || activeDirectMemberId() !== memberId) return;
        const text = currentText();
        setDirectOlderErrors((current) => ({
          ...current,
          [memberId]: text.errorMessage(error, text.t("conversation.direct.unreadFailed")),
        }));
      }
    }

    async function sendDirectMessage(
      text: string,
      clientMessageId: string,
    ): Promise<{ message: DirectMessage; readError?: string }> {
      const memberId = activeDirectMemberId();
      if (!memberId) throw new Error(currentText().t("conversation.direct.noPerson"));
      const analytics = desktopAnalytics.scope();
      const serverKind = activeServer()?.kind ?? "unknown";
      let message: DirectMessage;
      try {
        message = await conversationPort().servers.sendDirectMessage({
          memberId,
          text,
          clientMessageId,
        });
      } catch (error) {
        analytics.track("message_send", {
          channel: "direct",
          attachment_count: 0,
          is_reply: false,
          result: "failed",
          failure_code: "send_failed",
          server_kind: serverKind,
        });
        throw error;
      }
      mergeDirectMessage(memberId, message);
      analytics.track("message_send", {
        channel: "direct",
        attachment_count: 0,
        is_reply: false,
        result: "succeeded",
        delivery_count: 1,
        server_kind: serverKind,
      });
      let readError: string | undefined;
      try {
        await markDirectMessagesRead(memberId, message.sequence);
      } catch (error) {
        const text = currentText();
        readError = text.errorMessage(error, text.t("conversation.direct.markReadFailed"));
      }
      await refreshDirectThreads();
      return { message, ...(readError ? { readError } : {}) };
    }

    async function markDirectMessagesRead(memberId = activeDirectMemberId(), throughSequence?: number): Promise<void> {
      if (!memberId) return;
      const serverId = activeServerId();
      const requestKey = `${serverId}\0${memberId}`;
      const snapshot = directConversations()[memberId];
      const boundary = throughSequence ?? snapshot?.messages.at(-1)?.sequence ?? 0;
      const previousOperation = directConversationReadOperations.get(requestKey) ?? Promise.resolve();
      const operation: Promise<void> = previousOperation
        .catch(() => undefined)
        .then(async () => {
          if (!scopeIsCurrent()) return;
          const readState = await conversationPort().servers.markDirectRead({
            memberId,
            throughSequence: boundary,
          });
          if (!scopeIsCurrent()) return;
          setDirectConversations((current) => {
            const currentSnapshot = current[memberId];
            if (!currentSnapshot) return current;
            const nextReadState =
              conversationVisible() && activeDirectMemberId() === memberId
                ? readState
                : preserveKnownDirectUnread(readState, boundary, currentSnapshot.messages, currentTeamMember()?.id);
            return { ...current, [memberId]: { ...currentSnapshot, readState: nextReadState } };
          });
          await refreshDirectThreads();
          const latestSequence = directConversations()[memberId]?.messages.at(-1)?.sequence ?? boundary;
          if (
            directConversationReadOperations.get(requestKey) === operation &&
            conversationVisible() &&
            activeDirectMemberId() === memberId &&
            latestSequence > boundary
          ) {
            queueMicrotask(() => {
              const latestVisibleSequence = directConversations()[memberId]?.messages.at(-1)?.sequence ?? boundary;
              if (
                scopeIsCurrent() &&
                conversationVisible() &&
                activeDirectMemberId() === memberId &&
                latestVisibleSequence > boundary
              ) {
                void markDirectMessagesRead(memberId, latestVisibleSequence).catch(() => undefined);
              }
            });
          }
        });
      directConversationReadOperations.set(requestKey, operation);
      try {
        await operation;
      } finally {
        if (directConversationReadOperations.get(requestKey) === operation) {
          directConversationReadOperations.delete(requestKey);
        }
      }
    }

    function setDirectTyping(typing: boolean): void {
      const memberId = activeDirectMemberId();
      if (!memberId) return;
      void conversationPort()
        .servers.setDirectTyping({ memberId, typing })
        .catch(() => undefined);
    }

    function mergeDirectMessage(memberId: string, message: DirectMessage): void {
      setDirectConversations((current) => {
        const snapshot = current[memberId] ?? {
          threadId: message.threadId,
          otherMemberId: memberId,
          messages: [],
          revision: 0,
          readState: { unreadCount: 0, firstUnreadMessageId: null, throughSequence: 0 },
        };
        if (snapshot.messages.some((candidate) => candidate.id === message.id)) return current;
        const readState = snapshot.readState ?? {
          unreadCount: 0,
          firstUnreadMessageId: null,
          throughSequence: 0,
        };
        const incomingUnread =
          message.senderMemberId !== currentTeamMember()?.id && message.sequence > readState.throughSequence;
        const visibleIncomingMessage = incomingUnread && activeDirectMemberId() === memberId && conversationVisible();
        let nextReadState = readState;
        if (visibleIncomingMessage && readState.unreadCount === 0) {
          nextReadState = {
            unreadCount: 0,
            firstUnreadMessageId: null,
            throughSequence: message.sequence,
          };
        } else if (incomingUnread && !visibleIncomingMessage) {
          nextReadState = {
            ...readState,
            unreadCount: readState.unreadCount + 1,
            firstUnreadMessageId: readState.firstUnreadMessageId ?? message.id,
          };
        }
        return {
          ...current,
          [memberId]: {
            ...snapshot,
            messages: (() => {
              const last = snapshot.messages[snapshot.messages.length - 1];
              if (!last || message.sequence >= last.sequence) return [...snapshot.messages, message];
              return [...snapshot.messages, message].sort((left, right) => left.sequence - right.sequence);
            })(),
            revision: Math.max(snapshot.revision, message.sequence),
            readState: nextReadState,
          },
        };
      });
    }

    function handleDirectMessageEvent(event: DirectMessageRealtimeEvent): void {
      const currentMemberId = currentTeamMember()?.id;
      if (!currentMemberId || !event.memberIds.includes(currentMemberId)) return;
      const otherMemberId =
        event.message.senderMemberId === currentMemberId
          ? event.message.recipientMemberId
          : event.message.senderMemberId;
      const markVisibleMessageRead =
        event.message.senderMemberId !== currentMemberId &&
        activeDirectMemberId() === otherMemberId &&
        conversationVisible() &&
        (directConversations()[otherMemberId]?.readState?.unreadCount ?? 0) === 0;
      mergeDirectMessage(otherMemberId, event.message);
      if (markVisibleMessageRead) {
        void markDirectMessagesRead(otherMemberId, event.message.sequence).catch(() => undefined);
      } else {
        void refreshDirectThreads();
      }
    }

    function handleDirectTypingEvent(event: DirectTypingRealtimeEvent): void {
      if (event.recipientMemberId !== currentTeamMember()?.id) return;
      setDirectTypingMemberIds((current) => {
        const next = new Set(current);
        if (event.typing) next.add(event.senderMemberId);
        else next.delete(event.senderMemberId);
        return next;
      });
    }

    function clearDirectSelection(): void {
      setActiveDirectMemberId(null);
    }

    function cancelDirectConversationRequests(): void {
      directConversationRequest += 1;
    }

    createEffect(
      () => ({
        memberId: activeDirectMemberId(),
        memberExists: activeDirectMember() !== undefined,
      }),
      ({ memberId, memberExists }) => {
        if (memberId && !memberExists) {
          cancelDirectConversationRequests();
          setActiveDirectMemberId(null);
          setDirectConversationError(null);
          setDirectConversationLoading(false);
        }
      },
    );

    createEffect(
      () => currentTeamMember()?.id ?? null,
      () => {
        if (peopleEnabled) void refreshDirectThreads();
      },
    );

    onSettled(() => {
      if (!peopleEnabled) return undefined;
      const unsubscribeMessage = conversationPort().servers.onDirectMessage((event) =>
        flush(() => handleDirectMessageEvent(event)),
      );
      const unsubscribeTyping = conversationPort().servers.onDirectTyping((event) =>
        flush(() => handleDirectTypingEvent(event)),
      );
      return () => {
        unsubscribeMessage();
        unsubscribeTyping();
      };
    });

    return {
      directThreads,
      directConversations,
      activeDirectMemberId,
      activeDirectMember,
      directConversationLoading,
      directConversationError,
      directConversationPages,
      directOlderLoading,
      directOlderErrors,
      directTypingMemberIds,
      refreshDirectThreads,
      refreshDirectConversation,
      openDirectConversation,
      loadOlderDirectMessages,
      openDirectMessage,
      sendDirectMessage,
      markDirectMessagesRead,
      conversationVisible,
      setDirectTyping,
      clearDirectSelection,
      cancelDirectConversationRequests,
    };
  },
});

export const DirectMessagesProvider = DirectMessages.provider;
export const useDirectMessages = DirectMessages.use;
