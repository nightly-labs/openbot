import {
  decodeXPageRules,
  X_PAGE_RULES_DEFAULT,
  type XPageRules,
  type XReplyPayload,
  xPageRulesHash,
} from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { track } from "./analytics";
import { startClientBrowser } from "./client-browser-worker";
import { openXChat } from "./extension-storage";
import {
  decodeStorageRequest,
  decodeXLabels,
  decodeXRequest,
  decodeXSendResult,
  decodeXStatus,
  OPEN_X_CHAT_MESSAGE,
  OUTBOX_FLUSH_MESSAGE,
  PANEL_PORT,
  type StorageRequest,
  X_MESSAGE,
  X_OFFSCREEN_MESSAGE,
  X_PANEL_MESSAGE,
  type XLabels,
  type XRequest,
} from "./x-messages";
import { type QueuedPost, readOutbox, retryWait, stillSendable, writeOutbox } from "./x-outbox";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const RULES_KEY = "openbot.x-rules.v1";
const RULES_CHECK_MS = 60 * 60 * 1_000;
const OFFSCREEN_PAGE = "offscreen.html";
const PANEL_PAGE = "sidepanel.html";
const OUTBOX_ALARM = "openbot-x-outbox";

let creating: Promise<void> | null = null;

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

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
}

const X_SENT_NOTIFICATION = "openbot-x-sent-";
const panels = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT || !port.sender?.url?.startsWith(chrome.runtime.getURL(PANEL_PAGE))) return;
  panels.add(port);
  void chrome.offscreen.closeDocument().catch(() => undefined);
  port.onDisconnect.addListener(() => {
    panels.delete(port);
    clientBrowser.panelClosed();
  });
});

const clientBrowser = startClientBrowser({ panelOpen: () => panels.size > 0, ensureOffscreen });

async function ask<T>(request: XRequest, decode: (value: unknown) => T): Promise<T> {
  const panel = await chrome.runtime.sendMessage({ ...request, kind: X_PANEL_MESSAGE }).catch(() => undefined);
  if (isDynamicRecord(panel)) return decode(panel);
  await ensureOffscreen();
  return decode(await chrome.runtime.sendMessage({ ...request, kind: X_OFFSCREEN_MESSAGE }));
}

let flushing: Promise<void> | null = null;

const LABELS_KEY = "openbot.x-labels.v1";

async function savedLabels(): Promise<XLabels | null> {
  return decodeXLabels((await chrome.storage.local.get(LABELS_KEY))[LABELS_KEY]);
}

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
      message: [body, line].filter(Boolean).join("\n"),
    })
    .catch(() => undefined);
}

let outboxChange: Promise<unknown> = Promise.resolve();

function changeOutbox<T>(change: () => Promise<T>): Promise<T> {
  const next = outboxChange.then(change);
  outboxChange = next.catch(() => undefined);
  return next;
}

function flushOutbox(force = false): Promise<void> {
  flushing ??= (async () => {
    try {
      const now = Date.now();
      const stored = await readOutbox();
      const labels = await savedLabels();
      const queued: QueuedPost[] = [];
      for (const post of stored) {
        if (stillSendable(post, now)) queued.push(post);
        else {
          void track("x_reply_action", { action: "dropped", attempts: post.attempts });
          if (labels) await notify(`openbot-x-dropped-${post.id}`, labels.droppedTitle, labels.droppedBody, post);
        }
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
          void track("x_reply_action", { action: "sent", attempts: post.attempts });
          if (labels)
            await notify(
              `${X_SENT_NOTIFICATION}${post.id}`,
              labels.sentTitle,
              post.attempts > 0 ? labels.sentBody : "",
              post,
            );
          continue;
        }
        const attempts = post.attempts + 1;
        const reached = answer === null || answer.ok || answer.reached;
        void track("x_reply_action", { action: "retry", attempts, reached });
        kept.push({
          ...post,
          attempts,
          nextAt: Date.now() + retryWait(attempts),
          error: answer && !answer.ok ? answer.error : null,
          reachedAt: post.reachedAt ?? (reached ? Date.now() : null),
        });
      }
      const next = await changeOutbox(async () => {
        const added = (await readOutbox()).filter((post) => !stored.some((entry) => entry.id === post.id));
        const all = [...kept, ...added];
        await writeOutbox(all);
        return all;
      });
      const due = Math.min(...next.map((post) => post.nextAt));
      if (Number.isFinite(due)) await chrome.alarms.create(OUTBOX_ALARM, { when: Math.max(due, Date.now() + 1_000) });
      else await chrome.alarms.clear(OUTBOX_ALARM);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

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
  await changeOutbox(async () => writeOutbox([...(await readOutbox()), post]));
  void track("x_reply_action", { action: "queued" });
  if (flushing) await flushing;
  await flushOutbox();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OUTBOX_ALARM) void flushOutbox();
});
chrome.runtime.onStartup.addListener(() => void flushOutbox(true));
chrome.runtime.onInstalled.addListener((details) => {
  void flushOutbox(true);
  if (details.reason === "install" || details.reason === "update")
    void track("extension_installed", {
      reason: details.reason,
      ...(details.previousVersion ? { from_version: details.previousVersion } : {}),
    });
});
void flushOutbox();
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith(X_SENT_NOTIFICATION)) {
    void track("x_reply_action", { action: "notification_opened" });
    void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => undefined);
    void openXChat(id.slice(X_SENT_NOTIFICATION.length)).then(() => {
      for (const port of panels) port.postMessage(OPEN_X_CHAT_MESSAGE);
    });
  }
  void chrome.notifications.clear(id).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const storage = decodeStorageRequest(message);
  if (storage) {
    if (sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN_PAGE)) return undefined;
    void storageAnswer(storage).then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (isDynamicRecord(message) && message.kind === OUTBOX_FLUSH_MESSAGE && fromExtensionPage(sender)) {
    void flushOutbox(true).then(
      () => sendResponse({}),
      () => sendResponse({}),
    );
    return true;
  }
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
        if (status.labels) void chrome.storage.local.set({ [LABELS_KEY]: { ...status.labels } }).catch(() => undefined);
        sendResponse(status);
      },
      () => sendResponse({}),
    );
    return true;
  }
  void queuePost(request.payload).catch(() => undefined);
  sendResponse({ queued: true });
  return undefined;
});
