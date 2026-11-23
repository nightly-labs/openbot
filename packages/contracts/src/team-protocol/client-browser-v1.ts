import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const CLIENT_BROWSER_CAPABILITY = "client-browser-v1";

export const CLIENT_BROWSER_ROUTES = {
  presence: "/v1/client-browser/presence",
  result: "/v1/client-browser/result",
} as const;

export const CLIENT_BROWSER_EVENT = "client-browser-command";

export const CLIENT_BROWSER_PRESENCE_TTL_MS = 75_000;
export const CLIENT_BROWSER_COMMAND_TIMEOUT_MS = 120_000;

export const CLIENT_BROWSER_LIMITS = {
  tabs: 50,
  tabId: 64,
  url: 8_192,
  title: 500,
  agentName: 200,
  commandId: 128,
  css: 2_000,
  targetText: 500,
  typeText: 50_000,
  key: 128,
  scroll: 100_000,
  waitMs: 30_000,
  coordinate: 100_000,
  resultText: 64_000,
  image: 800_000,
  error: 2_000,
} as const;

export type ClientTab = { id: string; url: string; title: string; active: boolean };

export type ClientBrowserPresence = { sharing: boolean; tabs: ClientTab[] };

export type ClientBrowserTarget = { ref: string } | { css: string } | { text: string } | { x: number; y: number };

export type ClientBrowserCommand =
  | { kind: "open"; url: string }
  | { kind: "navigate"; tabId: string; url: string }
  | { kind: "navigate"; tabId: string; direction: "back" | "forward" | "reload" }
  | { kind: "snapshot"; tabId: string }
  | { kind: "screenshot"; tabId: string }
  | { kind: "click"; tabId: string; target: ClientBrowserTarget }
  | { kind: "type"; tabId: string; target: ClientBrowserTarget; text: string; submit: boolean }
  | { kind: "press"; tabId: string; key: string }
  | { kind: "scroll"; tabId: string; deltaX: number; deltaY: number }
  | { kind: "wait_for"; tabId: string; text: string }
  | { kind: "wait_for"; tabId: string; ms: number }
  | { kind: "close_tab"; tabId: string };

export type ClientBrowserCommandEvent = {
  type: typeof CLIENT_BROWSER_EVENT;
  id: string;
  agentId: string;
  agentName: string;
  command: ClientBrowserCommand;
};

export type ClientBrowserResult = { text: string; image: string | null; tab: ClientTab | null };

export const CLIENT_BROWSER_FAILURE_CODES = ["denied", "not-shared", "not-found", "timeout", "failed"] as const;
export type ClientBrowserFailureCode = (typeof CLIENT_BROWSER_FAILURE_CODES)[number];

export type ClientBrowserAnswer =
  | { id: string; ok: true; result: ClientBrowserResult }
  | { id: string; ok: false; error: string; code: ClientBrowserFailureCode };

function invalid(): never {
  throw new Error("Invalid client browser value.");
}

function text(value: unknown, maximum: number, minimum = 0): string {
  return isString(value) && value.length >= minimum && value.length <= maximum ? value : invalid();
}

function finite(value: unknown, maximum: number, minimum = -maximum): number {
  return isNumber(value) && Number.isFinite(value) && value >= minimum && value <= maximum ? value : invalid();
}

function tabId(value: unknown): string {
  return isString(value) && /^[A-Za-z0-9_-]{1,64}$/u.test(value) ? value : invalid();
}

function webUrl(value: unknown): string {
  const url = text(value, CLIENT_BROWSER_LIMITS.url, 1);
  return URL.canParse(url) && /^https?:$/u.test(new URL(url).protocol) ? url : invalid();
}

function clientTab(value: unknown): ClientTab {
  if (!isDynamicRecord(value) || !isBoolean(value.active)) return invalid();
  return {
    id: tabId(value.id),
    url: text(value.url, CLIENT_BROWSER_LIMITS.url),
    title: text(value.title, CLIENT_BROWSER_LIMITS.title),
    active: value.active,
  };
}

function target(value: unknown): ClientBrowserTarget {
  if (!isDynamicRecord(value)) return invalid();
  const keys = Object.keys(value).sort().join(",");
  if (keys === "ref") return { ref: text(value.ref, 128, 1) };
  if (keys === "css") return { css: text(value.css, CLIENT_BROWSER_LIMITS.css, 1) };
  if (keys === "text") return { text: text(value.text, CLIENT_BROWSER_LIMITS.targetText, 1) };
  if (keys === "x,y")
    return {
      x: finite(value.x, CLIENT_BROWSER_LIMITS.coordinate, 0),
      y: finite(value.y, CLIENT_BROWSER_LIMITS.coordinate, 0),
    };
  return invalid();
}

export function decodeClientBrowserPresence(value: unknown): ClientBrowserPresence {
  if (!isDynamicRecord(value) || !isBoolean(value.sharing) || !Array.isArray(value.tabs)) return invalid();
  if (value.tabs.length > CLIENT_BROWSER_LIMITS.tabs) return invalid();
  return { sharing: value.sharing, tabs: value.tabs.map(clientTab) };
}

export function decodeClientBrowserResult(value: unknown): ClientBrowserResult {
  if (!isDynamicRecord(value)) return invalid();
  const image = value.image === null ? null : text(value.image, CLIENT_BROWSER_LIMITS.image, 1);
  if (image !== null && !/^[A-Za-z0-9+/]+={0,2}$/u.test(image)) return invalid();
  return {
    text: text(value.text, CLIENT_BROWSER_LIMITS.resultText),
    image,
    tab: value.tab === null ? null : clientTab(value.tab),
  };
}

export function decodeClientBrowserAnswer(value: unknown): ClientBrowserAnswer {
  if (!isDynamicRecord(value)) return invalid();
  const id = text(value.id, CLIENT_BROWSER_LIMITS.commandId, 1);
  if (value.ok === true) return { id, ok: true, result: decodeClientBrowserResult(value.result) };
  if (value.ok !== false || !isOneOf(CLIENT_BROWSER_FAILURE_CODES, value.code)) return invalid();
  return { id, ok: false, error: text(value.error, CLIENT_BROWSER_LIMITS.error), code: value.code };
}

export function decodeClientBrowserCommand(value: unknown): ClientBrowserCommand {
  if (!isDynamicRecord(value)) return invalid();
  if (value.kind === "open") return { kind: "open", url: webUrl(value.url) };
  const id = tabId(value.tabId);
  switch (value.kind) {
    case "navigate":
      if (value.url !== undefined) return { kind: "navigate", tabId: id, url: webUrl(value.url) };
      if (value.direction === "back" || value.direction === "forward" || value.direction === "reload")
        return { kind: "navigate", tabId: id, direction: value.direction };
      return invalid();
    case "snapshot":
    case "screenshot":
    case "close_tab":
      return { kind: value.kind, tabId: id };
    case "click":
      return { kind: "click", tabId: id, target: target(value.target) };
    case "type":
      if (!isBoolean(value.submit)) return invalid();
      return {
        kind: "type",
        tabId: id,
        target: target(value.target),
        text: text(value.text, CLIENT_BROWSER_LIMITS.typeText),
        submit: value.submit,
      };
    case "press":
      return { kind: "press", tabId: id, key: text(value.key, CLIENT_BROWSER_LIMITS.key, 1) };
    case "scroll":
      return {
        kind: "scroll",
        tabId: id,
        deltaX: finite(value.deltaX, CLIENT_BROWSER_LIMITS.scroll),
        deltaY: finite(value.deltaY, CLIENT_BROWSER_LIMITS.scroll),
      };
    case "wait_for":
      if (value.text !== undefined)
        return { kind: "wait_for", tabId: id, text: text(value.text, CLIENT_BROWSER_LIMITS.targetText, 1) };
      return { kind: "wait_for", tabId: id, ms: finite(value.ms, CLIENT_BROWSER_LIMITS.waitMs, 0) };
    default:
      return invalid();
  }
}

export function clientBrowserCommandEvent(value: unknown): ClientBrowserCommandEvent | null {
  if (!isDynamicRecord(value) || value.type !== CLIENT_BROWSER_EVENT) return null;
  return {
    type: CLIENT_BROWSER_EVENT,
    id: text(value.id, CLIENT_BROWSER_LIMITS.commandId, 1),
    agentId: text(value.agentId, 128, 1),
    agentName: text(value.agentName, CLIENT_BROWSER_LIMITS.agentName),
    command: decodeClientBrowserCommand(value.command),
  };
}

export const CLIENT_BROWSER_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CLIENT_BROWSER_ROUTES.presence, adminRoute(decodeClientBrowserPresence, empty)],
  [CLIENT_BROWSER_ROUTES.result, adminRoute(decodeClientBrowserAnswer, empty)],
]);
