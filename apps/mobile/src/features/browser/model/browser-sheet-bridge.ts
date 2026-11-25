import { useEffect, useSyncExternalStore } from "react";

export interface BrowserSheetControls {
  tabId: string | null;
  unseenTabIds: ReadonlySet<string>;
  canUseTab: boolean;
  openingTab: boolean;
  navigate: (direction: "back" | "forward") => void;
  reload: () => void;
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

export function useProvideBrowserSheetControls(serverId: string, agentId: string, value: BrowserSheetControls) {
  const id = key(serverId, agentId);
  useEffect(() => {
    const previous = controls.get(id);
    controls.set(id, value);
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

export function useBrowserSheetControls(serverId: string, agentId: string): BrowserSheetControls | null {
  return useSyncExternalStore(subscribe, () => controls.get(key(serverId, agentId)) ?? null);
}

export function latestBrowserSheetControls(serverId: string, agentId: string): BrowserSheetControls | null {
  return controls.get(key(serverId, agentId)) ?? null;
}
