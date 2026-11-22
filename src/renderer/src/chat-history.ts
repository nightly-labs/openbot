import type { AppTextKey } from "@openbot/i18n";
import type { ShortcutKeyEvent } from "@openbot/ui/features/settings/keyboard-shortcuts";
import { createStore } from "solid-js";
import { matchesShortcut, shortcutLabel } from "./keyboard-shortcut-preference";

export type ChatHistoryEntry = { kind: "agent" | "channel" | "person"; id: string };

const HISTORY_LIMIT = 50;

function sameEntry(a: ChatHistoryEntry | undefined, b: ChatHistoryEntry | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.id === b.id;
}

export function createChatHistory(exists: (entry: ChatHistoryEntry) => boolean) {
  const [state, setState] = createStore<{ entries: ChatHistoryEntry[]; index: number }>({ entries: [], index: -1 });

  function nearest(offset: 1 | -1): number {
    const open = state.entries[state.index];
    for (let index = state.index + offset; index >= 0 && index < state.entries.length; index += offset) {
      const entry = state.entries[index];
      if (entry && exists(entry) && !sameEntry(entry, open)) return index;
    }
    return -1;
  }

  return {
    previous: (): ChatHistoryEntry | undefined => state.entries[nearest(-1)],
    next: (): ChatHistoryEntry | undefined => state.entries[nearest(1)],
    nearest,
    entryAt: (index: number): ChatHistoryEntry | undefined => state.entries[index],
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

export function chatHistoryShortcut(event: ShortcutKeyEvent): "back" | "forward" | undefined {
  if (matchesShortcut(event, "back")) return "back";
  return matchesShortcut(event, "forward") ? "forward" : undefined;
}

export function chatHistoryKeys(translate: (key: AppTextKey) => string) {
  return { back: shortcutLabel("back", translate), forward: shortcutLabel("forward", translate) };
}
