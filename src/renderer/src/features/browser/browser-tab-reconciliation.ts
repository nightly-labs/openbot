import type { BrowserTab } from "@openbot/contracts/ipc";

export function activeTabAfterLoad(state: { tabs: readonly BrowserTab[]; activeTabId: string | null }): string | null {
  return state.activeTabId ?? state.tabs[0]?.id ?? null;
}

export function browserTabsAfterClose(
  tabs: readonly BrowserTab[],
  closedTabId: string,
  activeTabId: string | null,
): { tabs: BrowserTab[]; activeTabId: string | null } {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedTabId);
  const remaining = tabs.filter((tab) => tab.id !== closedTabId);
  if (activeTabId !== closedTabId) return { tabs: remaining, activeTabId };
  return { tabs: remaining, activeTabId: remaining[closedIndex]?.id ?? remaining[closedIndex - 1]?.id ?? null };
}
