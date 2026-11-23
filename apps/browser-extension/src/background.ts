import {
  decodeXPageRules,
  X_PAGE_RULES_DEFAULT,
  type XPageRules,
  type XReplyPayload,
  xPageRulesHash,
} from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { startClientBrowser } from "./client-browser-worker";
import {
  decodeStorageRequest,
  decodeXLabels,
  decodeXRequest,
  decodeXSendResult,
  decodeXStatus,
  OUTBOX_FLUSH_MESSAGE,
  PANEL_PORT,
  type StorageRequest,
  X_IDLE_MESSAGE,
  X_MESSAGE,
  X_OFFSCREEN_MESSAGE,
  X_PANEL_MESSAGE,
  type XLabels,
  type XRequest,
} from "./x-messages";
import { type QueuedPost, readOutbox, retryWait, stillSendable, writeOutbox } from "./x-outbox";

// A click on the toolbar button opens the side panel, which Chrome keeps across restarts. The worker
// also answers the content script on X: the selectors, and through the offscreen page the server.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/** The newest selectors from the account service, and when the worker last asked. */
const RULES_KEY = "openbot.x-rules.v1";
const RULES_CHECK_MS = 60 * 60 * 1_000;
const OFFSCREEN_PAGE = "offscreen.html";
const PANEL_PAGE = "sidepanel.html";
/** Wakes the worker when the next post from X is due. */
const OUTBOX_ALARM = "openbot-x-outbox";

let creating: Promise<void> | null = null;

/** The rules from the account service, or null when the built-in rules are the newest. */
async function remoteRules(): Promise<XPageRules | null> {
  const saved = (await chrome.storage.local.get(RULES_KEY))[RULES_KEY];
  const stored = isDynamicRecord(saved) ? decodeXPageRules(saved.rules) : null;
  const checkedAt = isDynamicRecord(saved) && typeof saved.checkedAt === "number" ? saved.checkedAt : 0;
  if (Date.now() - checkedAt < RULES_CHECK_MS) return stored;
  try {
    const have = await xPageRulesHash(stored ?? X_PAGE_RULES_DEFAULT);
    const url = new URL(import.meta.env.VITE_OPENBOT_X_RULES_URL);
    url.searchParams.set("hash", have);
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !isDynamicRecord(body) || !isString(body.hash)) return stored;
    let next = body.hash === have ? stored : null;
    if (body.rules !== null) {
      const decoded = decodeXPageRules(body.rules);
      // A copy that does not have its hash was cut or changed on the way: keep what the worker has.
      if (!decoded || (await xPageRulesHash(decoded)) !== body.hash) return stored;
      next = decoded;
    }
    if (next && (await xPageRulesHash(next)) === (await xPageRulesHash(X_PAGE_RULES_DEFAULT))) next = null;
    await chrome.storage.local.set({
      [RULES_KEY]: {
        rules: next ? { mention: next.mention, selectors: { ...next.selectors } } : null,
        checkedAt: Date.now(),
      },
    });
    return next;
  } catch {
    // Offline or a bad answer: the stored or built-in rules stay, and the next page load asks again.
    return stored;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ["WEB_RTC"],
      justification: "Keeps the connection to the user's OpenBot server for the posts that the user sends from X.",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function storageAnswer(request: StorageRequest) {
  if (request.op === "get") return { items: await chrome.storage.local.get(request.keys) };
  if (request.op === "set") await chrome.storage.local.set(request.items);
  else await chrome.storage.local.remove(request.keys);
  return {};
}

/** A page of this extension, also one in a tab. A content script has the address of its web page. */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
}

/** The side panels that are open. Each holds a port; Chrome closes the port with the panel. */
const panels = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  // The panel's page, also when it runs in a tab. A content script cannot have this address.
  if (port.name !== PANEL_PORT || !port.sender?.url?.startsWith(chrome.runtime.getURL(PANEL_PAGE))) return;
  panels.add(port);
  // The panel's connection takes the session of this sign-in, so the offscreen page's closes.
  void chrome.offscreen.closeDocument().catch(() => undefined);
  port.onDisconnect.addListener(() => {
    panels.delete(port);
    clientBrowser.panelClosed();
  });
  // The panel asks for the posts that wait once its connection is ready (`OUTBOX_FLUSH_MESSAGE`).
});

/** The tabs that the user shares with agents: the OpenBot tab group, its approvals and commands. */
const clientBrowser = startClientBrowser({ panelOpen: () => panels.size > 0, ensureOffscreen });

/** Passes `status` or `send` to an open side panel, or else to the offscreen page. */
async function ask<T>(request: XRequest, decode: (value: unknown) => T): Promise<T> {
  // An open side panel answers with its own connection. With no panel, no page answers, and the
  // offscreen page connects in its place.
  const panel = await chrome.runtime.sendMessage({ ...request, kind: X_PANEL_MESSAGE }).catch(() => undefined);
  if (isDynamicRecord(panel)) return decode(panel);
  await ensureOffscreen();
  return decode(await chrome.runtime.sendMessage({ ...request, kind: X_OFFSCREEN_MESSAGE }));
}

let flushing: Promise<void> | null = null;

/**
 * The texts of the notifications, in the user's language. The worker cannot load a language, so it
 * keeps the texts that the panel or the offscreen page sent with the last `status`.
 */
const LABELS_KEY = "openbot.x-labels.v1";

async function savedLabels(): Promise<XLabels | null> {
  return decodeXLabels((await chrome.storage.local.get(LABELS_KEY))[LABELS_KEY]);
}

/** A short line of the post, so the user knows which one. */
function postLine(post: QueuedPost): string {
  const target = post.payload.posts[post.payload.replyTo];
  const text = (post.payload.message || target?.text || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

async function notify(id: string, title: string, body: string, post: QueuedPost): Promise<void> {
  const line = postLine(post);
  await chrome.notifications
    .create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title,
      message: line ? `${body}\n${line}` : body,
    })
    .catch(() => undefined);
}

/** Sends each post whose time has come, and wakes the worker for the next one. */
function flushOutbox(force = false): Promise<void> {
  flushing ??= (async () => {
    try {
      const now = Date.now();
      const stored = await readOutbox();
      const labels = await savedLabels();
      const queued: QueuedPost[] = [];
      for (const post of stored) {
        if (stillSendable(post, now)) queued.push(post);
        else if (labels) await notify(`openbot-x-dropped-${post.id}`, labels.droppedTitle, labels.droppedBody, post);
      }
      const kept: QueuedPost[] = [];
      for (const post of queued) {
        if (!force && post.nextAt > now) {
          kept.push(post);
          continue;
        }
        const answer = await ask(
          { kind: X_MESSAGE, action: "send", payload: post.payload, clientMessageId: post.id },
          decodeXSendResult,
        ).catch(() => null);
        if (answer?.ok) {
          // A post that waited: the user learns that it arrived. One that arrived at once needs no word.
          if (post.attempts > 0 && labels)
            await notify(`openbot-x-sent-${post.id}`, labels.sentTitle, labels.sentBody, post);
          continue;
        }
        const attempts = post.attempts + 1;
        // No answer at all may also mean that the post arrived and only the answer was lost.
        const reached = answer === null || answer.ok || answer.reached;
        kept.push({
          ...post,
          attempts,
          nextAt: Date.now() + retryWait(attempts),
          error: answer && !answer.ok ? answer.error : null,
          reachedAt: post.reachedAt ?? (reached ? Date.now() : null),
        });
      }
      // A post that arrived while this ran stays in the queue.
      const added = (await readOutbox()).filter((post) => !stored.some((entry) => entry.id === post.id));
      const next = [...kept, ...added];
      await writeOutbox(next);
      const due = Math.min(...next.map((post) => post.nextAt));
      if (Number.isFinite(due)) await chrome.alarms.create(OUTBOX_ALARM, { when: Math.max(due, Date.now() + 1_000) });
      else await chrome.alarms.clear(OUTBOX_ALARM);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** X posts the reply at once; the post waits here until the server has it. */
async function queuePost(payload: XReplyPayload): Promise<void> {
  const post: QueuedPost = {
    id: crypto.randomUUID(),
    payload,
    createdAt: Date.now(),
    attempts: 0,
    nextAt: Date.now(),
    error: null,
    reachedAt: null,
  };
  // On disk before the first attempt, so a browser that quits now keeps the post.
  await writeOutbox([...(await readOutbox()), post]);
  if (flushing) await flushing;
  await flushOutbox();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OUTBOX_ALARM) void flushOutbox();
});
// After a browser start, every post that waited goes out at once: the server may be back. Chrome loads
// an unpacked or updated extension again at its start, and then says "installed" in place of "startup".
chrome.runtime.onStartup.addListener(() => void flushOutbox(true));
chrome.runtime.onInstalled.addListener(() => void flushOutbox(true));
// A worker that Chrome started again for any event sends the posts whose time has come.
void flushOutbox();
// A click on a notification opens the panel, which shows the post's thread.
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("openbot-x-sent-"))
    void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => undefined);
  void chrome.notifications.clear(id).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The offscreen page has no `chrome.storage`. Only that page of this extension may use the worker's.
  const storage = decodeStorageRequest(message);
  if (storage) {
    if (sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN_PAGE)) return undefined;
    void storageAnswer(storage).then(sendResponse, () => sendResponse({}));
    return true;
  }
  // The offscreen page had no work for a while: its connection closes with it, unless it keeps the
  // shared tabs on the server.
  if (isDynamicRecord(message) && message.kind === X_IDLE_MESSAGE && !sender.tab) {
    void clientBrowser.sharing().then((sharing) => {
      if (!sharing) void chrome.offscreen.closeDocument().catch(() => undefined);
    });
    return undefined;
  }
  // The panel's "Send now" for the posts that wait.
  if (isDynamicRecord(message) && message.kind === OUTBOX_FLUSH_MESSAGE && fromExtensionPage(sender)) {
    void flushOutbox(true).then(
      () => sendResponse({}),
      () => sendResponse({}),
    );
    return true;
  }
  // Only a content script asks; a page of the extension talks to the offscreen page itself.
  const request = decodeXRequest(message, X_MESSAGE);
  if (!request || !sender.tab) return undefined;
  if (request.action === "rules") {
    void remoteRules().then(
      (rules) => sendResponse({ rules: rules ? { mention: rules.mention, selectors: { ...rules.selectors } } : null }),
      () => sendResponse({}),
    );
    return true;
  }
  if (request.action === "status") {
    void ask(request, decodeXStatus).then(
      (status) => {
        // The texts of the notifications, for when no page is open to give them.
        if (status.labels) void chrome.storage.local.set({ [LABELS_KEY]: { ...status.labels } }).catch(() => undefined);
        sendResponse(status);
      },
      () => sendResponse({}),
    );
    return true;
  }
  // The side panel shows the agent's answer. Chrome opens it only during the user's click, and only
  // when no panel is open: a second panel would take the session of the first.
  if (!panels.size && sender.tab.id !== undefined)
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined);
  void queuePost(request.payload).catch(() => undefined);
  sendResponse({ queued: true });
  return undefined;
});
