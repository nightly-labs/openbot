import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createScrollFades } from "../../../components/createScrollFades";
import { errorMessage } from "../../../error-message";
import type { ConversationProps } from "../conversation-types";
import { calculateChatScrollMargin, chatHistoryBoundaryReached, createChatVirtualizer } from "../createChatVirtualizer";
import { scrollToLatestMessage } from "../MessageNavigation";
import {
  anchorNewMessages,
  countableTimelineMessage,
  type NewMessageTally,
  tallyNewMessages,
} from "../new-message-tally";
import { scrollToUnreadBoundary, unreadMessagesDividerIsVisible } from "../UnreadMessages";

export interface ScrollElements {
  scrollElement: () => HTMLDivElement | undefined;
  virtualRoot: () => HTMLDivElement | undefined;
  unreadMessagesDivider: () => HTMLDivElement | undefined;
}

export interface ScrollStickyState {
  getStickToLatest: () => boolean;
  setStickToLatest: (value: boolean) => void;
  getCurrentUnreadCount: () => number;
}

export interface ScrollStoreDeps {
  props: ConversationProps;
  markingRead: () => boolean;
  setMarkingRead: (reading: boolean) => void;
  setComposerError: (error: string | null) => void;
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

  const timelineMessages = createMemo(() => deps.props.messages.filter((message) => message.kind !== "thinking"));
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
        identity: `${deps.props.server?.id ?? "local"}:${deps.props.agent?.id ?? ""}`,
        length: rows.length,
        lastId: rows.at(-1)?.id,
      };
    },
    ({ identity }) => {
      const rows = timelineRows();
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

  const messageVirtualizer = createChatVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: () => timelineMessages().length,
    getScrollElement: () => deps.elements.scrollElement() ?? null,
    estimateSize: () => 128,
    getItemKey: (index) => timelineMessages()[index]?.id ?? index,
    keyVersion: () => `${timelineMessages()[0]?.id ?? ""}:${timelineMessages().at(-1)?.id ?? ""}`,
    scrollMargin: virtualScrollMargin,
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
    deps.setMarkingRead(true);
    deps.setComposerError(null);
    try {
      await deps.props.onMarkRead();
    } catch (error) {
      deps.setComposerError(errorMessage(error, "Could not mark messages as read."));
    } finally {
      deps.setMarkingRead(false);
    }
  }

  async function jumpToUnreadMessages(): Promise<void> {
    const scrollElement = deps.elements.scrollElement();
    const unreadMessagesDivider = deps.elements.unreadMessagesDivider();
    if (!scrollElement) return;
    if (!unreadMessagesDivider && deps.props.firstUnreadMessageId && deps.props.onOpenSearchMessage) {
      await deps.props.onOpenSearchMessage(deps.props.firstUnreadMessageId);
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
    updateScrollFade,
    updateVirtualScrollMargin,
    updateUnreadDividerVisibility,
    scheduleUnreadDividerVisibilityUpdate,
    markUnreadMessages,
    jumpToUnreadMessages,
    jumpToLatestMessage,
  };
}

export type ScrollStore = ReturnType<typeof createScrollStore>;
