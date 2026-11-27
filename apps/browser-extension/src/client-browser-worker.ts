import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import {
  CLIENT_BROWSER_COMMAND_TIMEOUT_MS,
  CLIENT_BROWSER_LIMITS,
  type ClientBrowserAnswer,
  type ClientBrowserCommandEvent,
  type ClientBrowserPresence,
  type ClientTab,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import { track } from "./analytics";
import { BrowserCommandError, clientTab, installExecutor, isWebUrl, runCommand } from "./client-browser-executor";
import {
  ASKS_KEY,
  type AskChoice,
  type AskKind,
  type AskLabels,
  BROWSER_ANSWER_MESSAGE,
  BROWSER_CHANGED_MESSAGE,
  BROWSER_HOLD_MESSAGE,
  BROWSER_PRESENCE_MESSAGE,
  BROWSER_RUN_MESSAGE,
  type BrowserAsk,
  decodeAnswer,
  decodeAsks,
  decodeRunRequest,
  decodeSites,
  OPENBOT_GROUP_TITLE,
  SHARING_KEY,
  SITES_KEY,
} from "./client-browser-messages";

const ASK_WAIT_MS = 100_000;
const DEADLINE_MARGIN_MS = 10_000;
const LATE = "The command took too long, and the agent was told that it did not run.";

function lateAnswer(id: string): ClientBrowserAnswer {
  return { id, ok: false, code: "timeout", error: LATE };
}
const KEEP_ALIVE_MS = 20_000;
const GROUP_COLOR = "pink";
const CHANGE_DELAY_MS = 400;
const ASK_NOTIFICATION = "openbot-browser-ask-";
const DOWNLOAD_GUARD_MS = 30_000;
const DOWNLOAD_START_MS = 500;
const DOWNLOAD_LINK_START_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DownloadGuard {
  event: ClientBrowserCommandEvent;
  labels: AskLabels;
  until: number;
  allowed: number;
  outcomes: Promise<string>[] | null;
}

function siteOf(url: string): string | null {
  return isWebUrl(url) && URL.canParse(url) ? new URL(url).origin : null;
}

interface Options {
  panelOpen: () => boolean;
  ensureOffscreen: () => Promise<void>;
}

export interface ClientBrowserWorker {
  panelClosed: () => void;
}

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
}

async function savedGroupId(): Promise<number | null> {
  const value = (await chrome.storage.local.get(SHARING_KEY))[SHARING_KEY];
  return isDynamicRecord(value) && isNumber(value.groupId) ? value.groupId : null;
}

async function findGroup(saved: number | null): Promise<number | null> {
  if (saved !== null) {
    const group = await chrome.tabGroups.get(saved).catch(() => null);
    if (group) return group.id;
  }
  return (await chrome.tabGroups.query({ title: OPENBOT_GROUP_TITLE }))[0]?.id ?? null;
}

async function sharedGroupId(): Promise<number | null> {
  const saved = await savedGroupId();
  const groupId = await findGroup(saved);
  if (groupId !== saved) await chrome.storage.local.set({ [SHARING_KEY]: { groupId } });
  return groupId;
}

async function presence(): Promise<ClientBrowserPresence> {
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const rank = (tab: chrome.tabs.Tab) => (tab.id === current?.id ? Number.MAX_SAFE_INTEGER : (tab.lastAccessed ?? 0));
  const tabs = (await chrome.tabs.query({})).filter((tab) => isWebUrl(tab.url));
  return {
    sharing: true,
    tabs: tabs
      .sort((left, right) => rank(right) - rank(left))
      .flatMap((tab) => clientTab(tab) ?? [])
      .slice(0, CLIENT_BROWSER_LIMITS.tabs),
  };
}

async function addToGroup(tabId: number): Promise<number | null> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const [inWindow] = await chrome.tabGroups.query({ title: OPENBOT_GROUP_TITLE, windowId: tab.windowId });
  const next = inWindow
    ? await chrome.tabs.group({ tabIds: [tabId], groupId: inWindow.id })
    : await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(next, { title: OPENBOT_GROUP_TITLE, color: GROUP_COLOR });
  await chrome.storage.local.set({ [SHARING_KEY]: { groupId: next } });
  return next;
}

async function approvedSites(): Promise<string[]> {
  return decodeSites((await chrome.storage.local.get(SITES_KEY))[SITES_KEY]);
}

async function readAsks(): Promise<BrowserAsk[]> {
  return decodeAsks((await chrome.storage.local.get(ASKS_KEY))[ASKS_KEY]);
}

async function writeAsks(asks: BrowserAsk[]): Promise<void> {
  if (asks.length) await chrome.storage.local.set({ [ASKS_KEY]: asks.map((ask) => ({ ...ask })) });
  else await chrome.storage.local.remove(ASKS_KEY);
}

export function startClientBrowser(options: Options): ClientBrowserWorker {
  installExecutor();
  const waiting = new Map<string, (choice: AskChoice | "timeout") => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const downloadGuards = new Map<string, DownloadGuard>();
  const deadlines = new Map<string, number>();

  function guardSite(site: string, event: ClientBrowserCommandEvent, labels: AskLabels): DownloadGuard {
    const guard = downloadGuards.get(site) ?? { event, labels, until: 0, allowed: 0, outcomes: null };
    guard.event = event;
    guard.labels = labels;
    guard.until = Date.now() + DOWNLOAD_GUARD_MS;
    downloadGuards.set(site, guard);
    return guard;
  }

  async function hold(): Promise<void> {
    if (options.panelOpen()) return;
    await options.ensureOffscreen();
    await chrome.runtime.sendMessage({ kind: BROWSER_HOLD_MESSAGE }).catch(() => undefined);
  }

  function changed(): void {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      void (async () => {
        await chrome.runtime.sendMessage({ kind: BROWSER_CHANGED_MESSAGE }).catch(() => undefined);
        await hold();
      })();
    }, CHANGE_DELAY_MS);
  }

  async function notify(ask: BrowserAsk, labels: AskLabels): Promise<void> {
    await chrome.notifications
      .create(`${ASK_NOTIFICATION}${ask.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: labels.title,
        message: `${labels.body}\n${ask.site}`,
      })
      .catch(() => undefined);
  }

  function ask(entry: BrowserAsk, labels: AskLabels, waitMs: number): Promise<AskChoice | "timeout"> {
    return new Promise((resolve) => {
      const keepAlive = setInterval(
        () => void chrome.storage.local.get(ASKS_KEY).catch(() => undefined),
        KEEP_ALIVE_MS,
      );
      const timer = setTimeout(() => finish("timeout"), waitMs);
      function finish(choice: AskChoice | "timeout") {
        if (!waiting.delete(entry.id)) return;
        clearInterval(keepAlive);
        clearTimeout(timer);
        void chrome.notifications.clear(`${ASK_NOTIFICATION}${entry.id}`).catch(() => undefined);
        void readAsks()
          .then((asks) => writeAsks(asks.filter((item) => item.id !== entry.id)))
          .catch(() => undefined)
          .finally(() => resolve(choice));
      }
      waiting.set(entry.id, finish);
      void readAsks()
        .then((asks) => writeAsks([...asks, entry]))
        .then(() => (options.panelOpen() ? undefined : notify(entry, labels)))
        .catch(() => finish("timeout"));
    });
  }

  async function allow(
    event: ClientBrowserCommandEvent,
    labels: AskLabels,
    kind: AskKind,
    url: string,
    detail: string,
  ): Promise<void> {
    if (!isWebUrl(url) || !URL.canParse(url))
      throw new BrowserCommandError("failed", "Agents can use only web pages (http and https).");
    const site = new URL(url).origin;
    guardSite(site, event, labels);
    if (kind === "site" && (await approvedSites()).includes(site)) return;
    const deadline = deadlines.get(event.id) ?? Number.POSITIVE_INFINITY;
    if (Date.now() >= deadline) throw new BrowserCommandError("timeout", LATE);
    const choice = await ask(
      {
        id: crypto.randomUUID(),
        agentName: event.agentName,
        site,
        kind,
        action: event.command.kind,
        detail: detail.slice(0, 300),
      },
      labels,
      Math.min(ASK_WAIT_MS, deadline - Date.now()),
    );
    void track("browser_sharing_ask", { kind, choice });
    if ((choice === "once" || choice === "always") && Date.now() >= deadline)
      throw new BrowserCommandError("timeout", LATE);
    if (choice === "timeout")
      throw new BrowserCommandError("timeout", "The person did not answer in time. Ask the person in the chat first.");
    if (choice === "deny") throw new BrowserCommandError("denied", "The person denied it.");
    if (choice === "always" && kind === "site") {
      const stored = (await chrome.storage.local.get(SITES_KEY))[SITES_KEY];
      const sites = isDynamicRecord(stored) ? stored : {};
      await chrome.storage.local.set({ [SITES_KEY]: { ...sites, [site]: "always" } });
    }
  }

  async function watchDownloads(
    event: ClientBrowserCommandEvent,
    labels: AskLabels,
    url: string,
    allowed: boolean,
    action: () => Promise<void>,
  ): Promise<string[]> {
    const site = siteOf(url);
    if (!site) {
      await action();
      return [];
    }
    const guard = guardSite(site, event, labels);
    const outcomes: Promise<string>[] = [];
    guard.allowed = allowed ? 1 : 0;
    guard.outcomes = outcomes;
    try {
      await action();
      const deadline = Date.now() + (allowed ? DOWNLOAD_LINK_START_MS : DOWNLOAD_START_MS);
      while (!outcomes.length && Date.now() < deadline) await sleep(100);
      return await Promise.all(outcomes);
    } finally {
      if (guard.outcomes === outcomes) guard.outcomes = null;
      guard.allowed = 0;
    }
  }

  function guardOf(item: chrome.downloads.DownloadItem): DownloadGuard | null {
    for (const url of [item.referrer, item.finalUrl, item.url]) {
      const site = siteOf(url);
      const guard = site ? downloadGuards.get(site) : undefined;
      if (guard && guard.until > Date.now()) return guard;
    }
    return null;
  }

  async function execute(event: ClientBrowserCommandEvent, labels: AskLabels): Promise<ClientBrowserAnswer> {
    const fail = (code: BrowserCommandError["code"], error: string): ClientBrowserAnswer => ({
      id: event.id,
      ok: false,
      code,
      error: error.slice(0, CLIENT_BROWSER_LIMITS.error),
    });
    try {
      const result = await runCommand(event.command, {
        groupId: await sharedGroupId(),
        allow: (kind, url, detail) => allow(event, labels, kind, url, detail),
        addToGroup: async (tabId) => {
          await addToGroup(tabId);
        },
        watchDownloads: (url, allowed, action) => watchDownloads(event, labels, url, allowed, action),
        workingLabel: labels.working,
      });
      return { id: event.id, ok: true, result };
    } catch (error) {
      if (error instanceof BrowserCommandError) return fail(error.code, error.message);
      return fail("failed", error instanceof Error ? error.message : "");
    }
  }

  function run(event: ClientBrowserCommandEvent, labels: AskLabels): Promise<ClientBrowserAnswer> {
    const deadline = Date.now() + CLIENT_BROWSER_COMMAND_TIMEOUT_MS - DEADLINE_MARGIN_MS;
    deadlines.set(event.id, deadline);
    const work = queue
      .then(() => (Date.now() >= deadline ? lateAnswer(event.id) : execute(event, labels)))
      .finally(() => deadlines.delete(event.id));
    queue = work.catch(() => undefined);
    return work;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isDynamicRecord(message) || !fromExtensionPage(sender)) return undefined;
    if (message.kind === BROWSER_RUN_MESSAGE) {
      const request = decodeRunRequest(message);
      if (!request) return undefined;
      void run(request.event, request.labels).then(sendResponse, () => sendResponse({}));
      return true;
    }
    if (message.kind === BROWSER_PRESENCE_MESSAGE) {
      void presence().then(
        (value) => sendResponse({ sharing: value.sharing, tabs: value.tabs.map((tab: ClientTab) => ({ ...tab })) }),
        () => sendResponse({ sharing: false, tabs: [] }),
      );
      return true;
    }
    const answer = message.kind === BROWSER_ANSWER_MESSAGE ? decodeAnswer(message) : null;
    if (answer) waiting.get(answer.id)?.(answer.choice);
    return undefined;
  });

  chrome.tabs.onUpdated.addListener((_tabId, change) => {
    if (change.groupId !== undefined || change.url || change.title) changed();
  });
  chrome.tabs.onRemoved.addListener(() => changed());
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const guard = guardOf(item);
    if (!guard) {
      suggest();
      return undefined;
    }
    const name = item.filename.split(/[\\/]/u).pop() || item.finalUrl || item.url;
    const page = isWebUrl(item.referrer) ? item.referrer : item.finalUrl || item.url;
    let decision: Promise<void>;
    if (guard.allowed > 0) {
      guard.allowed -= 1;
      decision = Promise.resolve();
    } else decision = allow(guard.event, guard.labels, "download", page, name);
    const outcome = decision.then(
      () => {
        suggest();
        return `The person allowed the download of ${name}.`;
      },
      async (error: unknown) => {
        await chrome.downloads.cancel(item.id).catch(() => undefined);
        suggest();
        const code = error instanceof BrowserCommandError ? error.code : "failed";
        return `The download of ${name} did not start: ${code === "denied" ? "the person denied it" : code === "timeout" ? "the person did not answer" : "it failed"}.`;
      },
    );
    guard.outcomes?.push(outcome);
    return true;
  });
  chrome.tabs.onActivated.addListener(() => changed());
  chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith(ASK_NOTIFICATION))
      void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => undefined);
  });

  void chrome.storage.local.remove(ASKS_KEY).catch(() => undefined);
  setTimeout(() => void hold().catch(() => undefined), 2_000);

  return {
    panelClosed: () => {
      setTimeout(() => void hold().catch(() => undefined), 1_000);
    },
  };
}
