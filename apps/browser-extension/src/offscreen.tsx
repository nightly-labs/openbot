import type { XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { formatLocale, loadLocale, resolveLocale } from "@openbot/i18n";
import { currentText, TextProvider } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { type ClientBrowserLink, createClientBrowserLink } from "./client-browser-link";
import { BROWSER_HOLD_MESSAGE, BROWSER_PRESENCE_MESSAGE } from "./client-browser-messages";
import { readServerId, readSession, useStorageArea } from "./extension-storage";
import { createHostConnection, type HostConnection } from "./host-connection";
import { xSend, xStatus } from "./x-agent";
import {
  decodeXRequest,
  isStoredItems,
  STORAGE_MESSAGE,
  X_IDLE_MESSAGE,
  X_OFFSCREEN_MESSAGE,
  type XSendResult,
  type XStatusAnswer,
} from "./x-messages";

// The hidden page that the worker opens for X and for shared tabs. It keeps one connection to the
// server that the user chose in the side panel, as the panel makes it, so a post from X reaches the X
// agent, and agents can use the shared tabs, while the panel is closed. It closes after a time with no
// work, but not while the user shares tabs.

const IDLE_MS = 10 * 60 * 1_000;

// Chrome gives an offscreen page `chrome.runtime` only, so the worker keeps the storage for it.
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
/**
 * The language loads while the listener below already takes messages: the worker sends its first
 * message as soon as Chrome made the page. Work waits for the language.
 */
const started = loadLocale(locale)
  .catch(() => undefined)
  .then(() => {
    // The provider sets the language of `currentText`, which the connection's errors use too.
    const root = document.getElementById("root");
    if (root)
      render(() => <TextProvider locale={locale} formatLocale={formatLocale("system", navigator.language)} />, root);
  });

interface Target {
  token: string;
  hostId: string;
  connection: HostConnection;
  capabilities: string[];
  /** The shared tabs on this connection (`client-browser-v1`). */
  link: ClientBrowserLink;
}

let target: Target | null = null;
/** One step at a time: a status and a send never connect twice. */
let queue: Promise<unknown> = Promise.resolve();
let idle: number | undefined;

function drop() {
  target?.link.dispose();
  void target?.connection.dispose();
  target = null;
}

async function currentTarget(): Promise<Target | null> {
  const session = await readSession();
  if (!session) {
    drop();
    return null;
  }
  const saved = await readServerId();
  if (target && target.token === session.token && (!saved || saved === target.hostId)) return target;
  drop();
  let link: ClientBrowserLink | null = null;
  const connection = await createHostConnection(session, {
    event: (event) => link?.handleEvent(event),
    // The server forgets a presence with its connection; a new connection sends it again.
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
    return target;
  } catch (error) {
    await connection.dispose();
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
    // The reason goes to the content script's console note of a development build.
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
    // The connection failed before `xSend` sent anything; `xSend` answers its own failures.
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : t("extension.chat.sendFailed"),
      reached: false,
    };
  }
}

/** Whether the user shares tabs now. The worker keeps the state. */
async function sharing(): Promise<boolean> {
  const answer = await chrome.runtime.sendMessage({ kind: BROWSER_PRESENCE_MESSAGE }).catch(() => null);
  return isDynamicRecord(answer) && answer.sharing === true;
}

function armIdle() {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    void sharing().then((shares) => {
      // The shared tabs keep the connection.
      if (shares) return armIdle();
      drop();
      void chrome.runtime.sendMessage({ kind: X_IDLE_MESSAGE });
    });
  }, IDLE_MS);
}

/** Connects while the user shares tabs, also again after the connection ended. */
function holdShared() {
  const work = queue
    .then(() => started)
    .then(async () => {
      if (!target && (await sharing())) await currentTarget();
    });
  queue = work.catch(() => undefined);
}
window.setInterval(holdShared, 30_000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The worker asks this page to keep the shared tabs on the server while no panel is open.
  if (isDynamicRecord(message) && message.kind === BROWSER_HOLD_MESSAGE && !sender.tab) {
    armIdle();
    holdShared();
    return undefined;
  }
  const request = decodeXRequest(message, X_OFFSCREEN_MESSAGE);
  // Only the worker passes these on; a content script never reaches this page directly.
  if (!request || sender.tab || request.action === "rules") return undefined;
  armIdle();
  const next = (): Promise<XStatusAnswer | XSendResult> =>
    request.action === "status" ? status() : send(request.payload, request.clientMessageId ?? crypto.randomUUID());
  const work = queue.then(() => started).then(next);
  queue = work.catch(() => undefined);
  void work.then(sendResponse, () => sendResponse({}));
  return true;
});
