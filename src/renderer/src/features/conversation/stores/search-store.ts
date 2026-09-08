import { createEffect, onCleanup } from "solid-js";
import type { ChatSearchMatch } from "../chat-search";
import { clearChatSearchHighlights, findChatSearchMatches, renderChatSearchHighlights } from "../chat-search";
import type { ConversationProps } from "../conversation-types";

export interface SearchStoreDeps {
  props: ConversationProps;
  chatSearchOpen: () => boolean;
  chatSearchQuery: () => string;
  activeChatSearchIndex: () => number;
  scrollElement: () => HTMLDivElement | undefined;
  revealMatch: () => void;
  setChatSearchOpen: (open: boolean) => void;
  setChatSearchQuery: (query: string) => void;
  chatSearchMatches: () => ChatSearchMatch[];
  setChatSearchMatches: (matches: ChatSearchMatch[]) => void;
  chatSearchMessageIds: () => string[];
  setChatSearchMessageIds: (ids: string[]) => void;
  setChatSearchTotal: (total: number) => void;
  setActiveChatSearchIndex: (update: number | ((current: number) => number)) => void;
}

export function createSearchStore(deps: SearchStoreDeps) {
  let chatSearchInput: HTMLInputElement | undefined;
  let chatSearchReturnFocus: HTMLElement | undefined;

  let chatSearchFrame: number | undefined;
  let chatSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let chatSearchRequest = 0;
  let lastChatSearchQuery = "";

  createEffect(
    () => ({
      open: deps.chatSearchOpen(),
      query: deps.chatSearchQuery(),
      messageSignature: deps.props.messages
        .map((message) => `${message.id}:${message.body}:${message.items?.join("\u0000") ?? ""}`)
        .join("\u0001"),
      remoteMessageIds: deps.chatSearchMessageIds(),
      activeRemoteIndex: deps.activeChatSearchIndex(),
    }),
    ({ open, query, remoteMessageIds, activeRemoteIndex }) => {
      if (chatSearchFrame !== undefined) cancelAnimationFrame(chatSearchFrame);
      if (chatSearchTimer !== undefined) clearTimeout(chatSearchTimer);
      const queryChanged = query !== lastChatSearchQuery;
      lastChatSearchQuery = query;
      if (!open || !query.trim()) {
        deps.setChatSearchMatches([]);
        if (remoteMessageIds.length > 0) deps.setChatSearchMessageIds([]);
        deps.setChatSearchTotal(0);
        deps.setActiveChatSearchIndex(-1);
        clearChatSearchHighlights();
        return;
      }
      if (deps.props.onSearchMessages) {
        if (queryChanged) {
          const request = ++chatSearchRequest;
          chatSearchTimer = setTimeout(() => {
            void deps.props
              .onSearchMessages?.(query)
              .then((result) => {
                if (request !== chatSearchRequest) return;
                deps.setChatSearchMessageIds(result.messageIds);
                deps.setChatSearchTotal(result.total);
                const index = result.messageIds.length > 0 ? 0 : -1;
                deps.setActiveChatSearchIndex(index);
                const messageId = result.messageIds[index];
                if (messageId) void deps.props.onOpenSearchMessage?.(messageId);
              })
              .catch(() => {
                if (request !== chatSearchRequest) return;
                deps.setChatSearchMessageIds([]);
                deps.setChatSearchTotal(0);
                deps.setActiveChatSearchIndex(-1);
              });
          }, 150);
        }
        const activeMessageId = remoteMessageIds[activeRemoteIndex];
        chatSearchFrame = requestAnimationFrame(() => {
          chatSearchFrame = undefined;
          const scrollElement = deps.scrollElement();
          if (!scrollElement || !activeMessageId) return;
          const matches = findChatSearchMatches(scrollElement, query).filter(
            (match) => match.message.dataset.chatSearchMessage === activeMessageId,
          );
          deps.setChatSearchMatches(matches);
        });
        return;
      }
      chatSearchFrame = requestAnimationFrame(() => {
        chatSearchFrame = undefined;
        const scrollElement = deps.scrollElement();
        if (!scrollElement) return;
        const matches = findChatSearchMatches(scrollElement, query);
        deps.setChatSearchMatches(matches);
        deps.setActiveChatSearchIndex((current) => {
          if (matches.length === 0) return -1;
          if (queryChanged || current < 0) return 0;
          return Math.min(current, matches.length - 1);
        });
      });
    },
  );

  createEffect(
    () => ({
      open: deps.chatSearchOpen(),
      matches: deps.chatSearchMatches(),
      activeIndex: deps.activeChatSearchIndex(),
    }),
    ({ open, matches, activeIndex }) => {
      if (!open) return;
      const renderedIndex = deps.props.onSearchMessages ? 0 : activeIndex;
      renderChatSearchHighlights(matches, renderedIndex);
      const match = matches[renderedIndex];
      if (!match) return;
      deps.revealMatch();
      match.message.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    },
  );

  onCleanup(() => {
    if (chatSearchFrame !== undefined) cancelAnimationFrame(chatSearchFrame);
    if (chatSearchTimer !== undefined) clearTimeout(chatSearchTimer);
    clearChatSearchHighlights();
  });

  function openChatSearch(): void {
    if (!deps.chatSearchOpen() && document.activeElement instanceof HTMLElement) {
      chatSearchReturnFocus = document.activeElement;
    }
    deps.setChatSearchOpen(true);
    requestAnimationFrame(() => {
      chatSearchInput?.focus();
      chatSearchInput?.select();
    });
  }

  function closeChatSearch(restoreFocus = true): void {
    deps.setChatSearchOpen(false);
    deps.setChatSearchQuery("");
    deps.setChatSearchMatches([]);
    deps.setChatSearchMessageIds([]);
    deps.setChatSearchTotal(0);
    deps.setActiveChatSearchIndex(-1);
    clearChatSearchHighlights();
    const returnFocus = chatSearchReturnFocus;
    if (restoreFocus && returnFocus?.isConnected) {
      requestAnimationFrame(() => returnFocus.focus());
    }
    chatSearchReturnFocus = undefined;
  }

  function moveChatSearch(direction: 1 | -1): void {
    const remoteIds = deps.chatSearchMessageIds();
    const total = deps.props.onSearchMessages ? remoteIds.length : deps.chatSearchMatches().length;
    if (total === 0) return;
    deps.setActiveChatSearchIndex((current) => {
      const next = (current + direction + total) % total;
      if (deps.props.onSearchMessages) {
        const messageId = remoteIds[next];
        if (messageId) void deps.props.onOpenSearchMessage?.(messageId);
      }
      return next;
    });
  }

  function handleChatSearchShortcut(event: KeyboardEvent): void {
    const primaryModifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLocaleLowerCase();
    if (primaryModifier && !event.altKey && !event.shiftKey && key === "f") {
      event.preventDefault();
      event.stopPropagation();
      openChatSearch();
      return;
    }
    if (!deps.chatSearchOpen() || !primaryModifier || event.altKey || key !== "g") return;
    event.preventDefault();
    event.stopPropagation();
    moveChatSearch(event.shiftKey ? -1 : 1);
  }

  const setChatSearchInputElement = (element: HTMLInputElement) => {
    chatSearchInput = element;
  };

  return {
    openChatSearch,
    closeChatSearch,
    moveChatSearch,
    handleChatSearchShortcut,
    setChatSearchInputElement,
  };
}

export type SearchStore = ReturnType<typeof createSearchStore>;
