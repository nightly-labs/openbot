import { createStore } from "solid-js";

export type ChatHistoryEntry = { kind: "agent" | "channel" | "person"; id: string; thread?: string };

const HISTORY_LIMIT = 50;

function sameChat(a: ChatHistoryEntry | undefined, b: ChatHistoryEntry | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.id === b.id;
}

function sameEntry(a: ChatHistoryEntry | undefined, b: ChatHistoryEntry | undefined): boolean {
  return sameChat(a, b) && a?.thread === b?.thread;
}

function completes(held: ChatHistoryEntry | undefined, entry: ChatHistoryEntry | undefined): boolean {
  return sameChat(held, entry) && (held?.thread === undefined || held.thread === entry?.thread);
}

export function createChatHistory(exists: (entry: ChatHistoryEntry) => boolean) {
  const [state, setState] = createStore<{ entries: ChatHistoryEntry[]; index: number }>({ entries: [], index: -1 });

  function nearest(offset: 1 | -1): number {
    const open = state.entries[state.index];
    for (let index = state.index + offset; index >= 0 && index < state.entries.length; index += offset) {
      const entry = state.entries[index];
      if (entry && exists(entry) && !sameEntry(entry, open) && !completes(entry, open)) return index;
    }
    return -1;
  }

  return {
    previous: (): ChatHistoryEntry | undefined => state.entries[nearest(-1)],
    next: (): ChatHistoryEntry | undefined => state.entries[nearest(1)],
    nearest,
    entryAt: (index: number): ChatHistoryEntry | undefined => state.entries[index],
    record(entry: ChatHistoryEntry, target: number | null) {
      if (target !== null && completes(state.entries[target], entry)) {
        setState((draft) => {
          draft.index = target;
          draft.entries[target] = entry;
        });
        return;
      }
      const held = state.entries[state.index];
      if (sameEntry(held, entry)) return;
      if (completes(held, entry) || (sameChat(held, entry) && held && !exists(held))) {
        setState((draft) => {
          draft.entries[draft.index] = entry;
        });
        return;
      }
      setState((draft) => {
        const entries = [...draft.entries.slice(0, draft.index + 1), entry].slice(-HISTORY_LIMIT);
        draft.entries = entries;
        draft.index = entries.length - 1;
      });
    },
  };
}

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

export function chatHistoryKeys(mac: boolean) {
  return mac ? { back: "⌘[", forward: "⌘]" } : { back: "Alt+←", forward: "Alt+→" };
}
