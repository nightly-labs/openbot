import {
  decodeXPageRules,
  decodeXReplyPayload,
  type XPageRules,
  type XReplyPayload,
} from "@openbot/contracts/browser-extension-x";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * The messages of the X feature. The content script on X asks the worker; the worker answers the rules
 * itself and passes `status` and `send` to the open side panel, or else to the offscreen page. Each holds
 * a server connection, and only one of them is open at a time: the account service gives a sign-in one
 * session per server, and the server keeps one connection per session.
 */
export const X_MESSAGE = "openbot-x";
/** A message that the worker passed on. Only the offscreen page answers it. */
export const X_OFFSCREEN_MESSAGE = "openbot-x-offscreen";
/** A message that the worker passed on to the side panel, which answers it with its own connection. */
export const X_PANEL_MESSAGE = "openbot-x-panel";
/**
 * The port that each open side panel holds to the worker. The worker closes the offscreen page while a
 * panel is open, so the panel's connection is the only one, and does not open a second panel.
 */
export const PANEL_PORT = "openbot-panel";
/** The panel asks the worker to send the posts from X that wait, now. */
export const OUTBOX_FLUSH_MESSAGE = "openbot-x-outbox-flush";
/** The offscreen page asks the worker to close it after a time with no work. */
export const X_IDLE_MESSAGE = "openbot-x-idle";
/** The offscreen page's reads and writes of `chrome.storage.local`, which the worker does for it. */
export const STORAGE_MESSAGE = "openbot-storage";

export type StorageRequest =
  | { kind: typeof STORAGE_MESSAGE; op: "get"; keys: string | string[] | null }
  | { kind: typeof STORAGE_MESSAGE; op: "set"; items: { [key: string]: chrome.storage.StoredValue } }
  | { kind: typeof STORAGE_MESSAGE; op: "remove"; keys: string | string[] };

const isKeys = (value: unknown): value is string | string[] =>
  isString(value) || (Array.isArray(value) && value.every(isString));

export function isStoredValue(value: unknown): value is chrome.storage.StoredValue {
  if (value === null || isString(value) || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isStoredValue);
  return isDynamicRecord(value) && Object.values(value).every(isStoredValue);
}

export function isStoredItems(value: unknown): value is { [key: string]: chrome.storage.StoredValue } {
  return isDynamicRecord(value) && Object.values(value).every(isStoredValue);
}

export function decodeStorageRequest(value: unknown): StorageRequest | null {
  if (!isDynamicRecord(value) || value.kind !== STORAGE_MESSAGE) return null;
  if (value.op === "get" && (value.keys === null || isKeys(value.keys)))
    return { kind: STORAGE_MESSAGE, op: "get", keys: value.keys };
  if (value.op === "set" && isStoredItems(value.items)) return { kind: STORAGE_MESSAGE, op: "set", items: value.items };
  if (value.op === "remove" && isKeys(value.keys)) return { kind: STORAGE_MESSAGE, op: "remove", keys: value.keys };
  return null;
}

export type XRequest =
  | { kind: typeof X_MESSAGE; action: "rules" }
  | { kind: typeof X_MESSAGE; action: "status" }
  /** From the worker, each attempt of one post has the same `clientMessageId`. */
  | { kind: typeof X_MESSAGE; action: "send"; payload: XReplyPayload; clientMessageId?: string };

/** The words that the content script shows on X, in the user's language. */
export interface XLabels {
  armed: string;
  /** The notification when a post that waited reached the server. */
  sentTitle: string;
  sentBody: string;
  /** The notification when the extension stopped trying. */
  droppedTitle: string;
  droppedBody: string;
}

const LABEL_KEYS = ["armed", "sentTitle", "sentBody", "droppedTitle", "droppedBody"] as const;

/** `ready` is true when the user is signed in, the server answers and it has the X agent. */
export interface XStatus {
  ready: boolean;
  labels: XLabels | null;
  /** Why the button stays as X made it. A development build writes it to the console. */
  reason: string;
}

/** Why the X feature is off: no session, the server failed, or the server has no X Desk. */
export type XNotReadyReason =
  | "signed-out"
  | "no-x-agent"
  | "panel-connecting"
  | "server-failed"
  | `server-failed (${string})`;

/** What the side panel or the offscreen page answers to `status`. */
export type XStatusAnswer = { ready: true; labels: XLabels } | { ready: false; reason: XNotReadyReason };

/**
 * `reached` is false when the attempt failed before it sent the post, so the server cannot have it, and
 * a retry cannot make a second thread at any later time.
 */
export type XSendResult = { ok: true } | { ok: false; error: string; reached: boolean };

export function decodeXRequest(value: unknown, kind: string): XRequest | null {
  if (!isDynamicRecord(value) || value.kind !== kind) return null;
  if (value.action === "rules" || value.action === "status") return { kind: X_MESSAGE, action: value.action };
  if (value.action !== "send") return null;
  const payload = decodeXReplyPayload(value.payload);
  if (!payload) return null;
  return isString(value.clientMessageId)
    ? { kind: X_MESSAGE, action: "send", payload, clientMessageId: value.clientMessageId }
    : { kind: X_MESSAGE, action: "send", payload };
}

export function decodeXRules(value: unknown): XPageRules | null {
  return isDynamicRecord(value) ? decodeXPageRules(value.rules) : null;
}

export function decodeXLabels(value: unknown): XLabels | null {
  if (!isDynamicRecord(value)) return null;
  const read = new Map<string, string>();
  for (const key of LABEL_KEYS) {
    const text = value[key];
    if (!isString(text)) return null;
    read.set(key, text.slice(0, 300));
  }
  return {
    armed: read.get("armed") ?? "",
    sentTitle: read.get("sentTitle") ?? "",
    sentBody: read.get("sentBody") ?? "",
    droppedTitle: read.get("droppedTitle") ?? "",
    droppedBody: read.get("droppedBody") ?? "",
  };
}

export function decodeXStatus(value: unknown): XStatus {
  if (!isDynamicRecord(value)) return { ready: false, labels: null, reason: "no-answer" };
  if (value.ready !== true)
    return { ready: false, labels: null, reason: isString(value.reason) ? value.reason.slice(0, 200) : "not-ready" };
  const labels = decodeXLabels(value.labels);
  return labels ? { ready: true, reason: "", labels } : { ready: false, labels: null, reason: "bad-answer" };
}

export function decodeXSendResult(value: unknown): XSendResult | null {
  if (!isDynamicRecord(value)) return null;
  if (value.ok === true) return { ok: true };
  if (value.ok !== false || !isString(value.error)) return null;
  // An answer without the field may have sent the post.
  return { ok: false, error: value.error, reached: value.reached !== false };
}
