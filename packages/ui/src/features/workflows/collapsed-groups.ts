/**
 * Which groups of the All workflows page the person folded, kept in the browser between visits. Every
 * call reads the stored list again before it writes, so two sets of groups on the page never overwrite
 * each other's choice. Storage can be missing or full; the page then folds for this visit only.
 */

import { createSignal } from "solid-js";

const STORAGE_KEY = "openbot.workflows.overview.collapsed.v1";

function read(): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

export interface CollapsedGroups {
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
}

export function createCollapsedGroups(): CollapsedGroups {
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(read());
  return {
    isCollapsed: (key) => folded().has(key),
    toggle: (key) => {
      const next = new Set(read());
      for (const entry of folded()) if (!next.has(entry)) next.add(entry);
      if (folded().has(key)) next.delete(key);
      else next.add(key);
      setFolded(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Not saved: the group stays folded until the page closes.
      }
    },
  };
}
