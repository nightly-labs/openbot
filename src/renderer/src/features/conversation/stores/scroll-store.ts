import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createScrollFades } from "../../../components/createScrollFades";
import type { ConversationProps } from "../conversation-types";
import { calculateChatScrollMargin, createChatVirtualizer } from "../createChatVirtualizer";
import { scrollToLatestMessage } from "../MessageNavigation";
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
  const [unreadDividerVisible, setUnreadDividerVisible] = createSignal(false);
  let unreadVisibilityFrame: number | undefined;

  const timelineMessages = createMemo(() => deps.props.messages.filter((message) => message.kind !== "thinking"));

  createEffect(
    () =>
      deps.props.loaded &&
      timelineMessages().length === 0 &&
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
      if (first && first.index <= 5 && deps.props.hasOlder && !deps.props.loadingOlder) deps.props.onLoadOlder?.();
    },
  });

  function updateScrollFade(element = deps.elements.scrollElement()) {
    if (!element) return;
    scrollFades.measure();
    setShowScrollToLatest(element.scrollHeight - element.scrollTop - element.clientHeight > 80);
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
      deps.setComposerError(error instanceof Error ? error.message : "Could not mark messages as read.");
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
