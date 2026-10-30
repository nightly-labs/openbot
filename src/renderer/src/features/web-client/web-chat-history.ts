import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createEffect, onCleanup, untrack } from "solid-js";

/** A chat that a browser history entry opens: an agent chat or a channel on one server. */
export type WebChatHistoryEntry = { hostId: string; kind: "agent" | "channel"; id: string };

/** The key of the chat in `history.state`. The site router keeps its own keys next to it. */
const CHAT_STATE_KEY = "openbotChat";
/** The entry index of the site router (`@tanstack/history`). A pop of one step must read as Back or Forward. */
const ROUTER_INDEX_KEY = "__TSR_index";

function sameEntry(a: WebChatHistoryEntry | null, b: WebChatHistoryEntry | null): boolean {
  return a !== null && b !== null && a.hostId === b.hostId && a.kind === b.kind && a.id === b.id;
}

function stateRecord(state: unknown): DynamicRecord {
  return isDynamicRecord(state) ? state : {};
}

/** `history.state` can hold anything that another page of the site wrote. */
function entryFromState(state: unknown): WebChatHistoryEntry | null {
  const value = isDynamicRecord(state) ? state[CHAT_STATE_KEY] : undefined;
  if (!isDynamicRecord(value)) return null;
  const { hostId, kind, id } = value;
  if (!isString(hostId) || !isString(id) || (kind !== "agent" && kind !== "channel")) return null;
  return { hostId, kind, id };
}

/**
 * Browser Back and Forward for the chats of the web app. Each chat that the user opens gets its own
 * history entry at the same address, so Back opens the chat before it, and Back from the first chat
 * leaves the app. A reload opens the chat of its entry again. A chat that opens by itself, after a
 * connect or a deleted agent, only updates the entry on screen.
 */
export function createWebChatHistory(options: {
  /** The chat on screen, or null when a page or a form covers it. */
  current: () => WebChatHistoryEntry | null;
  /** Opens the chat of an entry that Back or Forward reached. False when the chat cannot open. */
  open: (entry: WebChatHistoryEntry) => boolean;
}) {
  /** The next chat that matches gets a new entry. */
  let pushNext: ((entry: WebChatHistoryEntry) => boolean) | null = null;
  /** The chat that Back or Forward opens. The chats on screen before it opens do not change the entry. */
  let popped: WebChatHistoryEntry | null = null;
  /** The chat of the entry that a reload or a return to the page starts on. It opens once the workspace shows a chat. */
  let restored = entryFromState(window.history.state);

  function write(entry: WebChatHistoryEntry, push: boolean): void {
    const state = stateRecord(window.history.state);
    if (push) {
      const key = crypto.randomUUID();
      const index = state[ROUTER_INDEX_KEY];
      window.history.pushState(
        { [ROUTER_INDEX_KEY]: (isNumber(index) ? index : 0) + 1, key, __TSR_key: key, [CHAT_STATE_KEY]: entry },
        "",
        window.location.href,
      );
      return;
    }
    window.history.replaceState({ ...state, [CHAT_STATE_KEY]: entry }, "", window.location.href);
  }

  /** A chat that was deleted since then does not open. Its entry then takes the chat on screen. */
  function openEntry(entry: WebChatHistoryEntry): boolean {
    popped = entry;
    if (options.open(entry)) return true;
    popped = null;
    const current = untrack(options.current);
    if (current) write(current, false);
    return false;
  }

  createEffect(
    () => {
      const entry = options.current();
      return entry ? `${entry.hostId}:${entry.kind}:${entry.id}` : null;
    },
    () =>
      untrack(() => {
        const entry = options.current();
        if (!entry) return;
        if (restored) {
          const start = restored;
          restored = null;
          if (!sameEntry(start, entry) && openEntry(start)) return;
        }
        if (popped) {
          if (!sameEntry(popped, entry)) return;
          popped = null;
        }
        const held = entryFromState(window.history.state);
        const userChat = pushNext?.(entry) === true;
        if (userChat) pushNext = null;
        // While the user's chat opens, the chats before it do not take the entry of the chat that was open.
        else if (pushNext && held !== null) return;
        if (sameEntry(held, entry)) return;
        // The first chat of the page takes the entry of the page, so Back from it leaves the app.
        write(entry, userChat && held !== null);
      }),
  );

  const onPopState = (event: PopStateEvent) => {
    const entry = entryFromState(event.state);
    pushNext = null;
    restored = null;
    if (!entry || sameEntry(entry, untrack(options.current))) {
      popped = null;
      return;
    }
    openEntry(entry);
  };
  window.addEventListener("popstate", onPopState);
  onCleanup(() => window.removeEventListener("popstate", onPopState));

  return {
    /** Gives the chat that the user opens now its own entry. */
    userOpens(entry: WebChatHistoryEntry): void {
      if (sameEntry(entry, untrack(options.current))) return;
      pushNext = (next) => sameEntry(next, entry);
      popped = null;
      restored = null;
    },
    /** Opens again the entry that Back or Forward reached, when it matches. A server connect can finish after the first try. */
    reopen(match: (entry: WebChatHistoryEntry) => boolean): void {
      if (popped && match(popped)) openEntry(popped);
    },
    /** Gives the first chat of the server that the user opens now its own entry. */
    userOpensServer(hostId: string): void {
      pushNext = (next) => next.hostId === hostId;
      popped = null;
      restored = null;
    },
  };
}
