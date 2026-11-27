import type { XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { formatLocale, loadLocale, resolveLocale } from "@openbot/i18n";
import { currentText, TextProvider } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { type ClientBrowserLink, createClientBrowserLink } from "./client-browser-link";
import { BROWSER_HOLD_MESSAGE } from "./client-browser-messages";
import { readServerId, readSession, useStorageArea } from "./extension-storage";
import { createHostConnection, type HostConnection, isRefusedSession } from "./host-connection";
import { xSend, xStatus } from "./x-agent";
import {
  decodeXRequest,
  isStoredItems,
  STORAGE_MESSAGE,
  X_OFFSCREEN_MESSAGE,
  type XSendResult,
  type XStatusAnswer,
} from "./x-messages";

useStorageArea({
  get: async (keys) => {
    const answer = await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "get", keys });
    const items = isDynamicRecord(answer) ? answer.items : null;
    if (!isStoredItems(items)) throw new Error(currentText().t("extension.connection.requestFailed"));
    return items;
  },
  set: async (items) => {
    await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "set", items });
  },
  remove: async (keys) => {
    await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "remove", keys });
  },
});

const locale = resolveLocale("system", navigator.language);
const started = loadLocale(locale)
  .catch(() => undefined)
  .then(() => {
    const root = document.getElementById("root");
    if (root)
      render(() => <TextProvider locale={locale} formatLocale={formatLocale("system", navigator.language)} />, root);
  });

interface Target {
  token: string;
  hostId: string;
  connection: HostConnection;
  capabilities: string[];
  link: ClientBrowserLink;
}

interface FailedTarget {
  token: string;
  saved: string | null;
  retryAt: number;
  delayMs: number;
  error: unknown;
}

const TARGET_RETRY_MS = 30_000;
const TARGET_RETRY_MAX_MS = 5 * 60_000;

let target: Target | null = null;
let failed: FailedTarget | null = null;
let queue: Promise<unknown> = Promise.resolve();

function drop() {
  target?.link.dispose();
  void target?.connection.dispose();
  target = null;
}

function sameAttempt(attempt: FailedTarget | null, token: string, saved: string | null): attempt is FailedTarget {
  return attempt !== null && attempt.token === token && attempt.saved === saved;
}

function failTarget(token: string, saved: string | null, error: unknown): FailedTarget {
  const previous = sameAttempt(failed, token, saved) ? failed : null;
  const delayMs = previous ? Math.min(previous.delayMs * 2, TARGET_RETRY_MAX_MS) : TARGET_RETRY_MS;
  const retryAt = isRefusedSession(error) ? Number.POSITIVE_INFINITY : Date.now() + delayMs;
  return { token, saved, retryAt, delayMs, error };
}

async function currentTarget(): Promise<Target | null> {
  const session = await readSession();
  if (!session) {
    drop();
    failed = null;
    return null;
  }
  const saved = await readServerId();
  if (target && target.token === session.token && (!saved || saved === target.hostId)) return target;
  if (sameAttempt(failed, session.token, saved) && Date.now() < failed.retryAt) throw failed.error;
  drop();
  let link: ClientBrowserLink | null = null;
  const connection = await createHostConnection(session, {
    event: (event) => link?.handleEvent(event),
    state: (update) => {
      if (update.state === "online") link?.refresh();
    },
    sessionEnded: drop,
  });
  try {
    const hosts = await connection.listHosts();
    const host = hosts.find((entry) => entry.hostId === saved) ?? hosts[0];
    if (!host) throw new Error(currentText().t("extension.connection.noServers"));
    const capabilities = await connection.connect(host);
    link = createClientBrowserLink({ request: connection.request, capabilities });
    target = { token: session.token, hostId: host.hostId, connection, capabilities, link };
    failed = null;
    return target;
  } catch (error) {
    await connection.dispose();
    failed = failTarget(session.token, saved, error);
    throw error;
  }
}

async function status(): Promise<XStatusAnswer> {
  try {
    const current = await currentTarget();
    if (!current) return { ready: false, reason: "signed-out" };
    return await xStatus({
      hostId: current.hostId,
      request: current.connection.request,
      capabilities: current.capabilities,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 160) : "";
    return { ready: false, reason: detail ? `server-failed (${detail})` : "server-failed" };
  }
}

async function send(payload: XReplyPayload, clientMessageId: string): Promise<XSendResult> {
  const { t } = currentText();
  try {
    const current = await currentTarget();
    if (!current) return { ok: false, error: t("extension.x.signedOut"), reached: false };
    return await xSend(
      { hostId: current.hostId, request: current.connection.request, capabilities: current.capabilities },
      payload,
      clientMessageId,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : t("extension.chat.sendFailed"),
      reached: false,
    };
  }
}

function holdShared() {
  const work = queue
    .then(() => started)
    .then(async () => {
      if (!target) await currentTarget();
    });
  queue = work.catch(() => undefined);
}
window.setInterval(holdShared, 30_000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isDynamicRecord(message) && message.kind === BROWSER_HOLD_MESSAGE && !sender.tab) {
    holdShared();
    return undefined;
  }
  const request = decodeXRequest(message, X_OFFSCREEN_MESSAGE);
  if (!request || sender.tab || request.action === "rules") return undefined;
  const next = (): Promise<XStatusAnswer | XSendResult> =>
    request.action === "status" ? status() : send(request.payload, request.clientMessageId ?? crypto.randomUUID());
  const work = queue.then(() => started).then(next);
  queue = work.catch(() => undefined);
  void work.then(sendResponse, () => sendResponse({}));
  return true;
});
