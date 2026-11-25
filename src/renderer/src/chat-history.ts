import type { AppTextKey } from "@openbot/i18n";
import type { ShortcutKeyEvent } from "@openbot/ui/features/settings/keyboard-shortcuts";
import { createStore } from "solid-js";
import { matchesShortcut, shortcutLabel } from "./keyboard-shortcut-preference";

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

export function chatHistoryShortcut(event: ShortcutKeyEvent): "back" | "forward" | undefined {
  if (matchesShortcut(event, "back")) return "back";
  return matchesShortcut(event, "forward") ? "forward" : undefined;
}

export function chatHistoryKeys(translate: (key: AppTextKey) => string) {
  return { back: shortcutLabel("back", translate), forward: shortcutLabel("forward", translate) };
}
