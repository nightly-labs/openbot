// Two browser routes a remote client needs and the frozen codecs cannot carry.
//
// `POST /v1/browser/navigate` takes `["tabId", "direction"]` and `GET /v1/browser/tabs` answers a
// bare array. Both key lists are released, and a frozen projection drops every key outside its own,
// so a `url` added to the first would be silently deleted on the wire and the second has nowhere to
// put the active tab. Neither can change: that is the one thing a shipped protocol may never do.
//
// So they ride beside the frozen codec the way `queue-edit-v1.ts` does - a capability, a route
// predicate, and validation of their own - and reuse the released tab projection for the part that
// is unchanged. A host without the capability never serves these paths and the client never builds
// them; it keeps opening a tab for an address and guessing the active one, exactly as before.

import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";
import { decodeTeamProtocolV4BaseHttpResponse, type TeamProtocolV4BaseJsonObject } from "./v4-base";

export const TEAM_BROWSER_NAVIGATION_CAPABILITY = "browser-navigation";

export interface BrowserLoadRequest {
  tabId: string;
  url: string;
}

export function isBrowserDisplayRoute(method: string, path: string): boolean {
  return method === "GET" && pathname(path) === "/v1/browser/display";
}

export function isBrowserLoadRoute(method: string, path: string): boolean {
  return method === "POST" && pathname(path) === "/v1/browser/load";
}

export function decodeBrowserLoadRequest(value: unknown): BrowserLoadRequest {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.tabId) ||
    !isBoundedString(value.url, INPUT_LIMITS.browserUrl) ||
    value.url.length === 0
  ) {
    throw new Error("Invalid browser load request.");
  }
  return { tabId: value.tabId, url: value.url };
}

/**
 * The tabs keep the released projection, so the two lists a client can read cannot disagree about
 * what a tab is. Only `activeTabId` is new, and it is the whole reason the route exists: the tab
 * list alone made a client that had not yet received a `browser-changed` event treat the first tab
 * as the active one.
 */
export function decodeBrowserDisplayResponse(value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value) || !Array.isArray(value.tabs)) throw new Error("Invalid browser display response.");
  if (value.activeTabId !== null && !isIdentifier(value.activeTabId)) {
    throw new Error("Invalid browser display response.");
  }
  const tabs = decodeTeamProtocolV4BaseHttpResponse("GET", "/v1/browser/tabs", 200, value.tabs);
  // The released projection answers a list for a list, so this only guards the delegation itself.
  if (!Array.isArray(tabs)) throw new Error("Invalid browser display response.");
  return { tabs, activeTabId: value.activeTabId };
}

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}
