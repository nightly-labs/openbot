import type { BrowserTab } from "@openbot/contracts/ipc";
import type { BrowserHistoryEntry } from "@openbot/ui/features/browser/browser-suggestions";
import { createStore } from "solid-js";

/**
 * What the full browser view keeps for a server while the app runs: the order of the tabs in the top
 * row, the tabs that the user closed, and the pages of this session for the address suggestions.
 *
 * Main keeps tabs in the order it made them, and the wire has no order, so the order stays here. None
 * of it goes to disk, to a log or to the host.
 */

const CLOSED_LIMIT = 25;
const HISTORY_LIMIT = 200;

interface ClosedTab {
  url: string;
  index: number;
}

interface TabPlacement {
  afterId?: string;
  index?: number;
}

interface TabSession {
  /** The tab ids in the order of the top row. Ids that main does not list any more are skipped. */
  order: string[];
  /** Where the next new tab goes. */
  pending: TabPlacement | undefined;
  closed: ClosedTab[];
  history: BrowserHistoryEntry[];
}

const [sessions, setSessions] = createStore<Record<string, TabSession>>({});

function emptySession(): TabSession {
  return { order: [], pending: undefined, closed: [], history: [] };
}

function session(serverId: string): TabSession {
  return sessions[serverId] ?? emptySession();
}

function update(serverId: string, change: (session: TabSession) => void) {
  setSessions((state) => {
    state[serverId] ??= emptySession();
    const current = state[serverId];
    if (current) change(current);
  });
}

/** Only web pages are kept: not `about:`, `data:` or the pages of the app. */
function recordable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** The tabs in the order of the top row. A tab that is not in the order yet goes where it was placed. */
export function orderedBrowserTabs(serverId: string, tabs: readonly BrowserTab[]): BrowserTab[] {
  const { order } = session(serverId);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const known = new Set(order);
  const ordered = order.flatMap((id) => {
    const tab = byId.get(id);
    return tab ? [tab] : [];
  });
  for (const tab of tabs) {
    if (!known.has(tab.id)) ordered.push(tab);
  }
  return ordered;
}

/**
 * Takes the tabs that main lists into the order. The first new tab goes where `placeNextBrowserTab`
 * asked, others at the end. Run it each time the list changes.
 */
export function syncBrowserTabOrder(serverId: string, tabs: readonly BrowserTab[]) {
  const current = session(serverId);
  const listed = new Set(tabs.map((tab) => tab.id));
  const order = current.order.filter((id) => listed.has(id));
  const added = tabs.filter((tab) => !current.order.includes(tab.id));
  if (added.length === 0 && order.length === current.order.length) return;
  let pending = current.pending;
  for (const tab of added) {
    const afterIndex = pending?.afterId === undefined ? -1 : order.indexOf(pending.afterId);
    if (afterIndex >= 0) order.splice(afterIndex + 1, 0, tab.id);
    else if (pending?.index !== undefined) order.splice(Math.min(pending.index, order.length), 0, tab.id);
    else order.push(tab.id);
    pending = undefined;
  }
  update(serverId, (draft) => {
    draft.order = order;
    draft.pending = pending;
  });
}

/** The next tab that main lists goes after `afterId`, or at `index`. */
export function placeNextBrowserTab(serverId: string, placement: TabPlacement) {
  update(serverId, (draft) => {
    draft.pending = { ...placement };
  });
}

/** Moves a tab so that it ends at `index` of `tabs`, the order on the screen. */
export function moveBrowserTab(serverId: string, tabs: readonly BrowserTab[], tabId: string, index: number) {
  const ids = tabs.map((tab) => tab.id);
  const from = ids.indexOf(tabId);
  if (from < 0) return;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, tabId);
  update(serverId, (draft) => {
    draft.order = ids;
  });
}

/** Keeps a closed tab so that it can open again at its place. */
export function rememberClosedBrowserTab(serverId: string, tab: BrowserTab, index: number) {
  if (!recordable(tab.url)) return;
  update(serverId, (draft) => {
    draft.closed = [{ url: tab.url, index }, ...draft.closed].slice(0, CLOSED_LIMIT);
  });
}

/** The last closed tab, which is then removed from the list. */
export function takeClosedBrowserTab(serverId: string): ClosedTab | undefined {
  const [last] = session(serverId).closed;
  if (!last) return undefined;
  update(serverId, (draft) => {
    draft.closed = draft.closed.slice(1);
  });
  return last;
}

export function canReopenBrowserTab(serverId: string): boolean {
  return session(serverId).closed.length > 0;
}

/** Records a page that a tab shows. A second visit moves the page to the top. */
/** The page that each tab showed last, for each server. The full view mounts again, so it is kept here. */
const shownPages = new Map<string, Map<string, { url: string; title: string }>>();

/** A tab that shows a new address is a visit. A new title for the same address only names the page. */
export function recordBrowserPages(serverId: string, pages: readonly { tabId: string; url: string; title: string }[]) {
  const seen = shownPages.get(serverId) ?? new Map<string, { url: string; title: string }>();
  shownPages.set(serverId, seen);
  for (const page of pages) {
    const previous = seen.get(page.tabId);
    if (previous?.url !== page.url) recordBrowserVisit(serverId, page.url, page.title);
    else if (previous.title !== page.title) recordBrowserTitle(serverId, page.url, page.title);
    seen.set(page.tabId, { url: page.url, title: page.title });
  }
  const open = new Set(pages.map((page) => page.tabId));
  for (const tabId of seen.keys()) if (!open.has(tabId)) seen.delete(tabId);
}

function recordBrowserVisit(serverId: string, url: string, title: string) {
  if (!recordable(url)) return;
  update(serverId, (draft) => {
    const previous = draft.history.find((entry) => entry.url === url);
    const entry = { url, title: title || previous?.title || "", visits: (previous?.visits ?? 0) + 1 };
    draft.history = [entry, ...draft.history.filter((item) => item.url !== url)].slice(0, HISTORY_LIMIT);
  });
}

/** Updates the title of a page that is in the history, without a new visit. */
function recordBrowserTitle(serverId: string, url: string, title: string) {
  if (!title || !session(serverId).history.some((entry) => entry.url === url && entry.title !== title)) return;
  update(serverId, (draft) => {
    draft.history = draft.history.map((entry) => (entry.url === url ? { ...entry, title } : entry));
  });
}

export function browserSessionHistory(serverId: string): readonly BrowserHistoryEntry[] {
  return session(serverId).history;
}
