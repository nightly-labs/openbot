import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentMessage } from "@openbot/ui/data";
import type { RoutineRunToggleMarkerModel } from "@openbot/ui/features/conversation/ChatActionMarker";
import {
  calculateChatScrollMargin,
  chatHistoryBoundaryReached,
  createChatVirtualizer,
} from "@openbot/ui/features/conversation/createChatVirtualizer";
import { scrollToLatestMessage } from "@openbot/ui/features/conversation/MessageNavigation";
import {
  anchorNewMessages,
  countableTimelineMessage,
  type NewMessageTally,
  silentAgentAnswer,
  tallyNewMessages,
} from "@openbot/ui/features/conversation/new-message-tally";
import {
  scrollToUnreadBoundary,
  unreadMessagesDividerIsVisible,
} from "@openbot/ui/features/conversation/UnreadMessages";
import { currentText } from "@openbot/ui/text";
import type { VirtualItem } from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { groupAgentMessageMarkers, markOpenAgentMessages } from "../agent-message-timeline";
import type { ConversationProps, ConversationTarget } from "../conversation-types";
import { summarizeHostedSiteMessages } from "../hosted-site-timeline";
import {
  expandRoutineRunGroups,
  groupRoutineRunMarkers,
  placeRoutineRunTurns,
  type RoutineRunOpenState,
  routineRunToggleKey,
  routineRunTurnMessages,
  summarizeRoutineRunMessages,
} from "../routine-run-timeline";
import { isTurnAnswer } from "../turn-steps";
import { conversationOwnerId } from "./composer-store";

interface ScrollElements {
  scrollElement: () => HTMLDivElement | undefined;
  virtualRoot: () => HTMLDivElement | undefined;
  unreadMessagesDivider: () => HTMLDivElement | undefined;
}

interface ScrollStickyState {
  getStickToLatest: () => boolean;
  setStickToLatest: (value: boolean) => void;
  getCurrentUnreadCount: () => number;
}

export interface ScrollStoreDeps {
  props: ConversationProps;
  markingRead: () => boolean;
  setMarkingRead: (reading: boolean) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  /** The user's messages the host has not drawn yet. They follow the transcript. */
  pendingMessages: () => AgentMessage[];
  elements: ScrollElements;
  sticky: ScrollStickyState;
}

export function createScrollStore(deps: ScrollStoreDeps) {
  const scrollFades = createScrollFades();
  const [virtualScrollMargin, setVirtualScrollMargin] = createSignal(0);
  const [showScrollToLatest, setShowScrollToLatest] = createSignal(false);
  const [atHistoryBoundary, setAtHistoryBoundary] = createSignal(false);
  const [unreadDividerVisible, setUnreadDividerVisible] = createSignal(false);
  const [newMessageCount, setNewMessageCount] = createSignal(0);
  let unreadVisibilityFrame: number | undefined;
  let firstRenderedIndex = 0;
  let newMessages: NewMessageTally = { count: 0, anchorId: undefined };
  let talliedConversationIdentity: string | undefined;

  const [openRoutineRuns, setOpenRoutineRuns] = createSignal<RoutineRunOpenState>(new Map());
  // The thinking and the memory changes of a turn show in the steps above its answer. A turn with
  // no answer shows its memory changes in a row of their own.
  const answeredTurns = createMemo(
    () => new Set(deps.props.messages.flatMap((message) => (isTurnAnswer(message) ? [message.turnId] : []))),
  );
  const shownMessages = createMemo(() =>
    summarizeHostedSiteMessages(
      deps.props.messages.filter(
        (message) =>
          message.kind !== "thinking" &&
          !(message.kind === "memory-changes" && answeredTurns().has(message.turnId)) &&
          !silentAgentAnswer(message),
      ),
    ),
  );
  const routineRunTurns = createMemo(() => routineRunTurnMessages(deps.props.messages, shownMessages()));
  /* The messages of a routine run follow its row and open and close with it. */
  const drawnMessages = createMemo(() => [
    ...placeRoutineRunTurns(summarizeRoutineRunMessages(shownMessages()), routineRunTurns(), openRoutineRuns()),
    ...deps.pendingMessages(),
  ]);
  function toggleRoutineRun(marker: RoutineRunToggleMarkerModel): void {
    const key = routineRunToggleKey(marker);
    setOpenRoutineRuns((open) => new Map(open).set(key, marker.expanded !== true));
  }
  /* The exchange ids of the agent messages whose text shows under their marker. */
  const [openAgentMessages, setOpenAgentMessages] = createSignal<ReadonlySet<string>>(new Set());
  function toggleAgentMessage(messageId: string): void {
    setOpenAgentMessages((open) => {
      const next = new Set(open);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });
  }
  /*
   * An open chat marks its messages read at once, so read state loses the first unread message.
   * The visit keeps it until the reader opens another chat. A newer unread message replaces it.
   */
  const visitUnread = createMemo<{ identity: string; messageId: string | null }>((previous) => {
    const identity = `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`;
    const messageId = deps.props.firstUnreadMessageId;
    if (previous?.identity === identity && !messageId) return previous;
    return { identity, messageId };
  });
  /*
   * The unread divider sits on the first unread row the timeline draws. A silent answer has no row,
   * so the divider moves to the next row that has one; read state keeps the stored message. A
   * message that is not loaded keeps its id, so the jump can open its page.
   */
  const unreadBoundaryMessageId = createMemo(() => {
    const firstUnreadMessageId = visitUnread().messageId;
    const start = deps.props.messages.findIndex((message) => message.id === firstUnreadMessageId);
    if (start < 0) return firstUnreadMessageId;
    const drawn = new Set(drawnMessages().map((message) => message.id));
    return deps.props.messages.slice(start).find((message) => drawn.has(message.id))?.id ?? null;
  });
  /* A group of agent messages or routine runs stops at the unread divider, so the divider keeps its row. */
  const timelineMessages = createMemo(() => {
    const group = (messages: readonly AgentMessage[]) =>
      groupRoutineRunMarkers(groupAgentMessageMarkers(messages, unreadBoundaryMessageId()), unreadBoundaryMessageId());
    const state = deps.props.contextState;
    const startedAt =
      state?.agentId === deps.props.agent?.id && state?.threadId === deps.props.agent?.threadId
        ? state?.compaction?.startedAt
        : undefined;
    const messages = markOpenAgentMessages(drawnMessages(), openAgentMessages());
    const boundary =
      startedAt === undefined
        ? -1
        : messages.findIndex((message) => message.createdAt && Date.parse(message.createdAt) > startedAt);
    const rows =
      boundary < 0 ? group(messages) : [...group(messages.slice(0, boundary)), ...group(messages.slice(boundary))];
    return expandRoutineRunGroups(rows, messages, routineRunTurns(), openRoutineRuns());
  });
  /*
   * A row finds its message by id. The virtualizer gives a row its new index one tick after the list
   * changes, so a lookup by index draws the neighbouring message in the row for that tick.
   */
  const timelineIndexById = createMemo(
    () => new Map<VirtualItem["key"], number>(timelineMessages().map((message, index) => [message.id, index])),
  );
  /* Every row anchors the count, but only some rows add to it. */
  const timelineRows = createMemo(() =>
    deps.props.messages.map((message) => ({ id: message.id, countable: countableTimelineMessage(message) })),
  );

  function clearNewMessages(): void {
    newMessages = anchorNewMessages(timelineRows());
    setNewMessageCount(0);
  }

  /*
   * The count owns its identity guard instead of leaning on the effect that follows the bottom:
   * that one is created later, so on a thread switch this would run first and carry the count of
   * the thread the reader left into the thread they opened.
   */
  createEffect(
    () => {
      const rows = timelineRows();
      return {
        identity: `${deps.props.server?.id ?? "local"}:${conversationOwnerId(deps.props) ?? ""}`,
        rows,
        length: rows.length,
        lastId: rows.at(-1)?.id,
      };
    },
    ({ identity, rows }) => {
      if (identity !== talliedConversationIdentity) {
        talliedConversationIdentity = identity;
        newMessages = anchorNewMessages(rows);
        setNewMessageCount(0);
        return;
      }
      newMessages = tallyNewMessages(newMessages, rows, deps.sticky.getStickToLatest());
      setNewMessageCount(newMessages.count);
    },
  );

  createEffect(
    () =>
      deps.props.loaded &&
      (timelineMessages().length === 0 || atHistoryBoundary()) &&
      deps.props.hasOlder &&
      !deps.props.loadingOlder &&
      !deps.props.olderError,
    (needsOlderPage) => {
      if (needsOlderPage) deps.props.onLoadOlder?.();
    },
  );

  // A channel row is mostly a short message under an author; an agent row is often a longer answer.
  const rowEstimate = untrack(() => deps.props.channel) ? 84 : 128;
  const messageVirtualizer = createChatVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: () => timelineMessages().length,
    getScrollElement: () => deps.elements.scrollElement() ?? null,
    estimateSize: () => rowEstimate,
    getItemKey: (index) => timelineMessages()[index]?.id ?? index,
    keyVersion: () => `${timelineMessages()[0]?.id ?? ""}:${timelineMessages().at(-1)?.id ?? ""}`,
    scrollMargin: virtualScrollMargin,
    stickToLatest: deps.sticky.getStickToLatest,
    onChange: (instance) => {
      const first = instance.getVirtualItems()[0];
      if (!first) return;
      firstRenderedIndex = first.index;
      updateHistoryBoundary();
    },
  });

  /* One writer for the boundary: the row the virtualizer renders first, read where the reader is. */
  function updateHistoryBoundary(element = deps.elements.scrollElement()): void {
    setAtHistoryBoundary(chatHistoryBoundaryReached(element, firstRenderedIndex));
  }

  function updateScrollFade(element = deps.elements.scrollElement()) {
    if (!element) return;
    scrollFades.measure();
    updateHistoryBoundary(element);
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowScrollToLatest(remaining > 80);
    if (remaining <= 80) clearNewMessages();
  }

  function updateVirtualScrollMargin(): void {
    setVirtualScrollMargin(calculateChatScrollMargin(deps.elements.scrollElement(), deps.elements.virtualRoot()));
  }

  function updateUnreadDividerVisibility(): void {
    const scrollElement = deps.elements.scrollElement();
    const unreadMessagesDivider = deps.elements.unreadMessagesDivider();
    setUnreadDividerVisible(
      Boolean(
        deps.sticky.getCurrentUnreadCount() > 0 &&
          scrollElement &&
          unreadMessagesDivider &&
          unreadMessagesDividerIsVisible(scrollElement, unreadMessagesDivider),
      ),
    );
  }

  function scheduleUnreadDividerVisibilityUpdate(): void {
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
    unreadVisibilityFrame = requestAnimationFrame(() => {
      unreadVisibilityFrame = undefined;
      updateUnreadDividerVisibility();
    });
  }

  onCleanup(() => {
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
    unreadVisibilityFrame = undefined;
  });

  async function markUnreadMessages(): Promise<void> {
    if (deps.markingRead()) return;
    const agentId = conversationOwnerId(deps.props);
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    deps.setMarkingRead(true);
    deps.setComposerError(null, target);
    try {
      await deps.props.onMarkRead();
    } catch (error) {
      deps.setComposerError(currentText().errorMessage(error, currentText().t("chat.unread.markReadFailed")), target);
    } finally {
      deps.setMarkingRead(false);
    }
  }

  async function jumpToUnreadMessages(): Promise<void> {
    const scrollElement = deps.elements.scrollElement();
    const unreadMessagesDivider = deps.elements.unreadMessagesDivider();
    if (!scrollElement) return;
    const unreadBoundary = unreadBoundaryMessageId();
    if (!unreadBoundary) {
      // Every unread row is a silent answer: there is no row to scroll to, only read state to move.
      if (deps.props.firstUnreadMessageId) await markUnreadMessages();
      return;
    }
    if (!unreadMessagesDivider && deps.props.onOpenSearchMessage) {
      await deps.props.onOpenSearchMessage(unreadBoundary);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!unreadMessagesDivider) return;
    const divider = unreadMessagesDivider;
    const firstUnreadMessage = divider.nextElementSibling instanceof HTMLElement ? divider.nextElementSibling : divider;
    deps.sticky.setStickToLatest(false);
    scrollToUnreadBoundary(scrollElement, firstUnreadMessage);
    await markUnreadMessages();
    requestAnimationFrame(() => {
      if (!scrollElement) return;
      const settledBoundary = divider.isConnected ? divider : firstUnreadMessage;
      if (settledBoundary.isConnected) {
        scrollToUnreadBoundary(scrollElement, settledBoundary);
      }
    });
  }

  async function jumpToLatestMessage(): Promise<void> {
    const scrollElement = deps.elements.scrollElement();
    if (!scrollElement) return;
    deps.sticky.setStickToLatest(true);
    // A smooth scroll fires no scroll event in a test environment, so the count clears here too.
    clearNewMessages();
    if (deps.props.discontinuous) {
      await deps.props.onLoadLatest?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    scrollToLatestMessage(scrollElement);
  }

  return {
    scrollFades,
    virtualScrollMargin,
    showScrollToLatest,
    setShowScrollToLatest,
    unreadDividerVisible,
    setUnreadDividerVisible,
    newMessageCount,
    clearNewMessages,
    messageVirtualizer,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    timelineIndexById,
    unreadBoundaryMessageId,
    updateScrollFade,
    updateVirtualScrollMargin,
    updateUnreadDividerVisibility,
    scheduleUnreadDividerVisibilityUpdate,
    markUnreadMessages,
    jumpToUnreadMessages,
    jumpToLatestMessage,
  };
}
