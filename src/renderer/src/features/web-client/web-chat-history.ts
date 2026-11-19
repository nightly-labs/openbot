import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createEffect, onCleanup, untrack } from "solid-js";

export type WebChatHistoryEntry = { hostId: string; kind: "agent" | "channel"; id: string };

const CHAT_STATE_KEY = "openbotChat";
const ROUTER_INDEX_KEY = "__TSR_index";

function sameEntry(a: WebChatHistoryEntry | null, b: WebChatHistoryEntry | null): boolean {
  return a !== null && b !== null && a.hostId === b.hostId && a.kind === b.kind && a.id === b.id;
}

function stateRecord(state: unknown): DynamicRecord {
  return isDynamicRecord(state) ? state : {};
}

function entryFromState(state: unknown): WebChatHistoryEntry | null {
  const value = isDynamicRecord(state) ? state[CHAT_STATE_KEY] : undefined;
  if (!isDynamicRecord(value)) return null;
  const { hostId, kind, id } = value;
  if (!isString(hostId) || !isString(id) || (kind !== "agent" && kind !== "channel")) return null;
  return { hostId, kind, id };
}

export function createWebChatHistory(options: {
  current: () => WebChatHistoryEntry | null;
  open: (entry: WebChatHistoryEntry) => boolean;
}) {
  let pushNext: ((entry: WebChatHistoryEntry) => boolean) | null = null;
  let popped: WebChatHistoryEntry | null = null;
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
        else if (pushNext && held !== null) return;
        if (sameEntry(held, entry)) return;
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
    userOpens(entry: WebChatHistoryEntry): void {
      if (sameEntry(entry, untrack(options.current))) return;
      pushNext = (next) => sameEntry(next, entry);
      popped = null;
      restored = null;
    },
    reopen(match: (entry: WebChatHistoryEntry) => boolean): void {
      if (popped && match(popped)) openEntry(popped);
    },
    userOpensServer(hostId: string): void {
      pushNext = (next) => next.hostId === hostId;
      popped = null;
      restored = null;
    },
  };
}
