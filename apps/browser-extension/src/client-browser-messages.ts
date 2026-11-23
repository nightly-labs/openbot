import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  type ClientBrowserCommand,
  type ClientBrowserCommandEvent,
  clientBrowserCommandEvent,
} from "@openbot/contracts/team-protocol/client-browser-v1";

/**
 * The messages of tab sharing (`client-browser-v1`). The page that holds the server connection (the
 * side panel, or else the offscreen page) sends the presence and receives the commands. Only the
 * worker can use `chrome.debugger`, so it owns the tab group, the approvals and the commands: the page
 * passes each command to the worker and posts the worker's answer to the server.
 */
/** A page passes a command to the worker, which answers with a `ClientBrowserAnswer`. */
export const BROWSER_RUN_MESSAGE = "openbot-browser-run";
/** A page asks the worker for the presence: whether the user shares, and the tabs of the group. */
export const BROWSER_PRESENCE_MESSAGE = "openbot-browser-presence";
/** The worker tells the pages that the presence changed. */
export const BROWSER_CHANGED_MESSAGE = "openbot-browser-changed";
/** The side panel starts or stops sharing. */
export const BROWSER_SHARE_MESSAGE = "openbot-browser-share";
/** The side panel's answer to an approval card. */
export const BROWSER_ANSWER_MESSAGE = "openbot-browser-answer";
/** The worker asks the offscreen page to connect, so that the shared tabs stay shared with no panel. */
export const BROWSER_HOLD_MESSAGE = "openbot-browser-hold";

/** Present while the user shares: `{ groupId }`, the id of the OpenBot tab group, or null. */
export const SHARING_KEY = "openbot.client-browser.sharing.v1";
/** The sites that the user allowed always: `{ [origin]: "always" }`. */
export const SITES_KEY = "openbot.client-browser.sites.v1";
/** The approval cards that wait for the user. The worker writes them; the side panel shows them. */
export const ASKS_KEY = "openbot.client-browser.asks.v1";
/** The last presence that the server accepted: `{ sharing, tabs, at }`. */
export const PRESENCE_KEY = "openbot.client-browser.presence.v1";

/** The title of the tab group that agents may use. A product name, the same in every language. */
export const OPENBOT_GROUP_TITLE = "OpenBot";

/**
 * Why a card asks. `site`: the agent acts on a site for the first time. The others ask on every site,
 * also an approved one: typing into a password or payment field, a download, and a sign-in grant.
 */
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

/** An approval card. `detail` names what the action uses: an element, an address, a key or a file. */
export interface BrowserAsk {
  id: string;
  agentName: string;
  site: string;
  kind: AskKind;
  action: ClientBrowserCommand["kind"];
  detail: string;
}

/** The notification of a card while no side panel is open, in the user's language. */
export interface AskLabels {
  title: string;
  body: string;
  /** The pill over a tab while an agent uses it. */
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

/** The approved sites, oldest first. */
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

export function decodePresenceAck(value: unknown): PresenceAck | null {
  if (!isDynamicRecord(value) || !isBoolean(value.sharing) || !isNumber(value.tabs) || !isNumber(value.at)) return null;
  return { sharing: value.sharing, tabs: value.tabs, at: value.at };
}
