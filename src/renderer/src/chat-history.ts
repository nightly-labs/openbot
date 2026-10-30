import { createStore } from "solid-js";

/** A chat that the window opened: an agent chat, a channel, or a direct conversation with a person. */
export type ChatHistoryEntry = { kind: "agent" | "channel" | "person"; id: string };

/** The oldest visits drop off after this many, as in a browser tab. */
const HISTORY_LIMIT = 50;

function sameEntry(a: ChatHistoryEntry | undefined, b: ChatHistoryEntry | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.id === b.id;
}

/**
 * The chats this window opened, in order, for Back and Forward. It lives in memory only and belongs to
 * one server scope. `exists` tells whether a chat can still open: Back and Forward step over a deleted
 * agent or channel and a person who left.
 */
export function createChatHistory(exists: (entry: ChatHistoryEntry) => boolean) {
  const [state, setState] = createStore<{ entries: ChatHistoryEntry[]; index: number }>({ entries: [], index: -1 });

  /**
   * The index of the nearest chat in that direction that can still open, or -1. A skipped chat can
   * leave the open chat on both sides of it, so the open chat is skipped too.
   */
  function nearest(offset: 1 | -1): number {
    const open = state.entries[state.index];
    for (let index = state.index + offset; index >= 0 && index < state.entries.length; index += offset) {
      const entry = state.entries[index];
      if (entry && exists(entry) && !sameEntry(entry, open)) return index;
    }
    return -1;
  }

  return {
    /** The chat that Back opens. */
    previous: (): ChatHistoryEntry | undefined => state.entries[nearest(-1)],
    /** The chat that Forward opens. */
    next: (): ChatHistoryEntry | undefined => state.entries[nearest(1)],
    nearest,
    entryAt: (index: number): ChatHistoryEntry | undefined => state.entries[index],
    /**
     * Records the chat that is open now. A move to `target` that opened it keeps the history, so
     * Forward still works after Back. Any other chat drops the forward entries, as a browser does.
     */
    record(entry: ChatHistoryEntry, target: number | null) {
      if (target !== null && sameEntry(state.entries[target], entry)) {
        setState((draft) => {
          draft.index = target;
        });
        return;
      }
      if (sameEntry(state.entries[state.index], entry)) return;
      setState((draft) => {
        const entries = [...draft.entries.slice(0, draft.index + 1), entry].slice(-HISTORY_LIMIT);
        draft.entries = entries;
        draft.index = entries.length - 1;
      });
    },
  };
}

/**
 * The key of Back or Forward: ⌘[ and ⌘] on macOS, Alt+← and Alt+→ elsewhere, as in a browser. Alt+←
 * in a text field stays with the field.
 */
export function chatHistoryShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
  mac: boolean,
): "back" | "forward" | undefined {
  if (event.shiftKey) return undefined;
  if (mac) {
    if (!event.metaKey || event.altKey || event.ctrlKey) return undefined;
    return event.key === "[" ? "back" : event.key === "]" ? "forward" : undefined;
  }
  if (!event.altKey || event.metaKey || event.ctrlKey || editableTarget(event.target)) return undefined;
  return event.key === "ArrowLeft" ? "back" : event.key === "ArrowRight" ? "forward" : undefined;
}

function editableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** The keys of Back and Forward, as a tooltip shows them on this platform. */
export function chatHistoryKeys(mac: boolean) {
  return mac ? { back: "⌘[", forward: "⌘]" } : { back: "Alt+←", forward: "Alt+→" };
}
