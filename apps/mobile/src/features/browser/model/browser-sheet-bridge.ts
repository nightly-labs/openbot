import { useEffect, useSyncExternalStore } from "react";

/**
 * What the browser sheet reads and does. The browser screen stays open under the sheet and owns the
 * live view, the tab on screen and the notices, so the sheet acts through it.
 */
export interface BrowserSheetControls {
  /** The tab on screen. */
  tabId: string | null;
  /** The tabs that opened behind the tab on screen. */
  unseenTabIds: ReadonlySet<string>;
  canUseTab: boolean;
  openingTab: boolean;
  navigate: (direction: "back" | "forward") => void;
  reload: () => void;
  /** Loads a web address in the tab on screen. */
  loadUrl: (url: string) => void;
  openTab: () => void;
  closeTab: (tabId: string) => void;
  chooseTab: (tabId: string) => void;
}

const controls = new Map<string, BrowserSheetControls>();
const listeners = new Set<() => void>();

function key(serverId: string, agentId: string) {
  return `${serverId}:${agentId}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Gives the sheet of this agent's browser the screen's state and actions, while the screen is open. */
export function useProvideBrowserSheetControls(serverId: string, agentId: string, value: BrowserSheetControls) {
  const id = key(serverId, agentId);
  useEffect(() => {
    const previous = controls.get(id);
    controls.set(id, value);
    // The actions change on each render; the sheet reads them when it is used. Only state is news.
    if (
      previous?.tabId !== value.tabId ||
      previous.unseenTabIds !== value.unseenTabIds ||
      previous.canUseTab !== value.canUseTab ||
      previous.openingTab !== value.openingTab
    ) {
      for (const listener of listeners) listener();
    }
  });
  useEffect(
    () => () => {
      controls.delete(id);
      for (const listener of listeners) listener();
    },
    [id],
  );
}

/**
 * The browser screen under the sheet, or null when it closed. Its state renders the sheet; an action
 * runs from `latestBrowserSheetControls`, which has the screen's newest tab list.
 */
export function useBrowserSheetControls(serverId: string, agentId: string): BrowserSheetControls | null {
  return useSyncExternalStore(subscribe, () => controls.get(key(serverId, agentId)) ?? null);
}

export function latestBrowserSheetControls(serverId: string, agentId: string): BrowserSheetControls | null {
  return controls.get(key(serverId, agentId)) ?? null;
}
