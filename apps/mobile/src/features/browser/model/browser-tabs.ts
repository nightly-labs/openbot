import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export interface MobileBrowserTab {
  id: string;
  title: string;
  url: string;
  ownerAgentId: string | null;
  ownerThreadId: string | null;
}

export interface MobileBrowserTabs {
  tabs: MobileBrowserTab[];
  activeTabId: string | null;
}

export type MobileHttpSignIns = Record<string, { origin: string; refused: boolean }>;

export function mobileHttpSignIns(
  prompts: readonly { tabId: string; origin: string; refused: boolean }[],
): MobileHttpSignIns {
  return Object.fromEntries(prompts.map(({ tabId, origin, refused }) => [tabId, { origin, refused }]));
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

export function decodeMobileBrowserTab(value: unknown): MobileBrowserTab {
  const tab = mobileBrowserTab(value);
  if (!tab) throw new Error("The host returned an invalid browser tab.");
  return tab;
}

export function decodeMobileBrowserTabs(value: unknown): MobileBrowserTab[] {
  if (!Array.isArray(value)) throw new Error("The host returned an invalid browser tab list.");
  return value.flatMap((tab) => {
    const decoded = mobileBrowserTab(tab);
    return decoded ? [decoded] : [];
  });
}

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

export function withBrowserTab(state: MobileBrowserTabs | undefined, tab: MobileBrowserTab): MobileBrowserTabs {
  const tabs = state?.tabs ?? [];
  if (tabs.some((candidate) => candidate.id === tab.id)) return state ?? { tabs, activeTabId: null };
  return { tabs: [...tabs, tab], activeTabId: state?.activeTabId ?? null };
}

export function withoutBrowserTab(state: MobileBrowserTabs | undefined, tabId: string): MobileBrowserTabs {
  return {
    tabs: (state?.tabs ?? []).filter((tab) => tab.id !== tabId),
    activeTabId: state?.activeTabId === tabId ? null : (state?.activeTabId ?? null),
  };
}

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

export function browserTabTitle(tab: MobileBrowserTab, untitled: string): string {
  if (tab.title.trim()) return tab.title;
  return browserTabHost(tab) || untitled;
}

export function browserTabHost(tab: MobileBrowserTab): string {
  return urlHost(tab.url);
}

export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const SEARCH_URL = "https://www.google.com/search?q=";

export function browserAddressUrl(value: string): string {
  const hasProtocol = /^https?:\/\//i.test(value);
  const candidate = hasProtocol ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (
      !/\s/.test(value) &&
      (hasProtocol || url.hostname.includes(".") || url.hostname === "localhost" || url.hostname.startsWith("["))
    ) {
      return candidate;
    }
  } catch {}
  return `${SEARCH_URL}${encodeURIComponent(value.replace(/^https?:\/\//i, ""))}`;
}
