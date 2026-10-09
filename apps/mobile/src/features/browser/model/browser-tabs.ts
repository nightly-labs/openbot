import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/** The part of a host browser tab that the phone uses. */
export interface MobileBrowserTab {
  id: string;
  title: string;
  url: string;
  ownerAgentId: string | null;
  ownerThreadId: string | null;
}

export interface MobileBrowserTabs {
  tabs: MobileBrowserTab[];
  /** The tab the host's browser shows, which can belong to any agent. */
  activeTabId: string | null;
}

function mobileBrowserTab(value: unknown): MobileBrowserTab | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.title) || !isString(value.url)) return null;
  return {
    id: value.id,
    title: value.title,
    url: value.url,
    ownerAgentId: isString(value.ownerAgentId) ? value.ownerAgentId : null,
    ownerThreadId: isString(value.ownerThreadId) ? value.ownerThreadId : null,
  };
}

/** The tab that `POST /v1/browser/open` answers with. */
export function decodeMobileBrowserTab(value: unknown): MobileBrowserTab {
  const tab = mobileBrowserTab(value);
  if (!tab) throw new Error("The host returned an invalid browser tab.");
  return tab;
}

/** The tab list of `GET /v1/browser/tabs` or a `browser-changed` event. A tab the phone cannot read is left out. */
export function decodeMobileBrowserTabs(value: unknown): MobileBrowserTab[] {
  if (!Array.isArray(value)) throw new Error("The host returned an invalid browser tab list.");
  return value.flatMap((tab) => {
    const decoded = mobileBrowserTab(tab);
    return decoded ? [decoded] : [];
  });
}

/**
 * The agent's tabs, oldest first: the tabs with the agent's ID as their owner, and, as on the desktop,
 * a tab with no agent owner that belongs to the agent's thread.
 */
export function agentBrowserTabs(
  state: MobileBrowserTabs | undefined,
  agentId: string,
  threadId: string | null = null,
): MobileBrowserTab[] {
  if (!state) return [];
  return state.tabs.filter((tab) =>
    tab.ownerAgentId ? tab.ownerAgentId === agentId : threadId !== null && tab.ownerThreadId === threadId,
  );
}

/** The list with a tab the phone opened, before the host's next list arrives. */
export function withBrowserTab(state: MobileBrowserTabs | undefined, tab: MobileBrowserTab): MobileBrowserTabs {
  const tabs = state?.tabs ?? [];
  if (tabs.some((candidate) => candidate.id === tab.id)) return state ?? { tabs, activeTabId: null };
  return { tabs: [...tabs, tab], activeTabId: state?.activeTabId ?? null };
}

/** The list without a tab the phone closed. */
export function withoutBrowserTab(state: MobileBrowserTabs | undefined, tabId: string): MobileBrowserTabs {
  return {
    tabs: (state?.tabs ?? []).filter((tab) => tab.id !== tabId),
    activeTabId: state?.activeTabId === tabId ? null : (state?.activeTabId ?? null),
  };
}

/**
 * The tab an agent works in: `preferredTabId` when it is the agent's, such as the tab of a takeover
 * or the tab the user chose, then the host's active tab when it is the agent's, otherwise the agent's
 * newest tab.
 */
export function agentBrowserTab(
  state: MobileBrowserTabs | undefined,
  agentId: string,
  preferredTabId?: string,
  threadId: string | null = null,
): MobileBrowserTab | null {
  if (!state) return null;
  const owned = agentBrowserTabs(state, agentId, threadId);
  return (
    owned.find((tab) => tab.id === preferredTabId) ??
    owned.find((tab) => tab.id === state.activeTabId) ??
    owned.at(-1) ??
    null
  );
}
