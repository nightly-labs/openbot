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

export function decodeBrowserDisplayResponse(value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value) || !Array.isArray(value.tabs)) throw new Error("Invalid browser display response.");
  if (value.activeTabId !== null && !isIdentifier(value.activeTabId)) {
    throw new Error("Invalid browser display response.");
  }
  const tabs = decodeTeamProtocolV4BaseHttpResponse("GET", "/v1/browser/tabs", 200, value.tabs);
  if (!Array.isArray(tabs)) throw new Error("Invalid browser display response.");
  return { tabs, activeTabId: value.activeTabId };
}

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}
