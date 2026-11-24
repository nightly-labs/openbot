import { isBoolean, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  type ClientBrowserCommand,
  type ClientBrowserCommandEvent,
  clientBrowserCommandEvent,
} from "@openbot/contracts/team-protocol/client-browser-v1";

export const BROWSER_RUN_MESSAGE = "openbot-browser-run";
export const BROWSER_PRESENCE_MESSAGE = "openbot-browser-presence";
export const BROWSER_CHANGED_MESSAGE = "openbot-browser-changed";
export const BROWSER_SHARE_MESSAGE = "openbot-browser-share";
export const BROWSER_ANSWER_MESSAGE = "openbot-browser-answer";
export const BROWSER_HOLD_MESSAGE = "openbot-browser-hold";

export const SHARING_KEY = "openbot.client-browser.sharing.v1";
export const SITES_KEY = "openbot.client-browser.sites.v1";
export const ASKS_KEY = "openbot.client-browser.asks.v1";
export const PRESENCE_KEY = "openbot.client-browser.presence.v1";

export const OPENBOT_GROUP_TITLE = "OpenBot";

export const ASK_KINDS = ["site", "password", "payment", "download", "sign-in"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export const ASK_CHOICES = ["once", "always", "deny"] as const;
export type AskChoice = (typeof ASK_CHOICES)[number];
const ACTIONS = [
  "open",
  "navigate",
  "snapshot",
  "screenshot",
  "click",
  "type",
  "press",
  "scroll",
  "wait_for",
  "close_tab",
] as const satisfies readonly ClientBrowserCommand["kind"][];

export interface BrowserAsk {
  id: string;
  agentName: string;
  site: string;
  kind: AskKind;
  action: ClientBrowserCommand["kind"];
  detail: string;
}

export interface AskLabels {
  title: string;
  body: string;
  working: string;
}

export interface RunRequest {
  event: ClientBrowserCommandEvent;
  labels: AskLabels;
}

export function decodeRunRequest(value: unknown): RunRequest | null {
  if (!isDynamicRecord(value) || value.kind !== BROWSER_RUN_MESSAGE || !isDynamicRecord(value.labels)) return null;
  const { title, body, working } = value.labels;
  if (!isString(title) || !isString(body) || !isString(working)) return null;
  try {
    const event = clientBrowserCommandEvent(value.event);
    return event
      ? { event, labels: { title: title.slice(0, 200), body: body.slice(0, 300), working: working.slice(0, 200) } }
      : null;
  } catch {
    return null;
  }
}

export function decodeAsks(value: unknown): BrowserAsk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): BrowserAsk[] => {
    if (!isDynamicRecord(entry)) return [];
    const { id, agentName, site, kind, action, detail } = entry;
    if (!isString(id) || !isString(agentName) || !isString(site) || !isString(detail)) return [];
    if (!isOneOf(ASK_KINDS, kind) || !isOneOf(ACTIONS, action)) return [];
    return [{ id, agentName, site, kind, action, detail }];
  });
}

export function decodeSites(value: unknown): string[] {
  if (!isDynamicRecord(value)) return [];
  return Object.entries(value).flatMap(([origin, grant]) => (grant === "always" ? [origin] : []));
}

export function decodeAnswer(value: unknown): { id: string; choice: AskChoice } | null {
  if (!isDynamicRecord(value) || value.kind !== BROWSER_ANSWER_MESSAGE || !isString(value.id)) return null;
  return isOneOf(ASK_CHOICES, value.choice) ? { id: value.id, choice: value.choice } : null;
}

export function decodeShare(value: unknown): { on: boolean } | null {
  if (!isDynamicRecord(value) || value.kind !== BROWSER_SHARE_MESSAGE || !isBoolean(value.on)) return null;
  return { on: value.on };
}

export interface PresenceAck {
  sharing: boolean;
  tabs: number;
  at: number;
}
