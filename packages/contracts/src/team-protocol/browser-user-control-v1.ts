// Frozen optional browser-user-control wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member takes
// control of a host browser tab that the member can see, and gives it back. While a person holds a tab,
// the browser tool calls of the owning agent on that tab wait until the release, and then tell the agent
// that the page may have changed. Any member who can see the tab releases it. The host refuses a take
// while a secret request is active on the tab. The host releases the holds of a session when the
// session ends. Each change sends `browser-user-control-changed` with the whole list of held tabs that
// the member can see. All three routes answer with that list. Bounds and meaning do not follow IPC
// changes; widening any of it needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const BROWSER_USER_CONTROL_CAPABILITY = "browser-user-control";
export const BROWSER_USER_CONTROL_ROUTES = {
  state: "/v1/browser/user-control",
  take: "/v1/browser/user-control/take",
  release: "/v1/browser/user-control/release",
} as const;

const exactTab: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "tabId"))
    throw new Error("Invalid browser user control request.");
  return fields({ tabId: identifier })(input);
};
const tabIds = list(identifier, 1000);
const snapshot = fields({ tabIds });
function heldTabIds(input: unknown): string[] {
  const decoded = tabIds(input);
  if (!Array.isArray(decoded)) throw new Error("Invalid browser user control list.");
  return decoded.filter(isString);
}

export const BROWSER_USER_CONTROL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_USER_CONTROL_ROUTES.state, adminRoute(empty, snapshot)],
  [BROWSER_USER_CONTROL_ROUTES.take, adminRoute(exactTab, snapshot)],
  [BROWSER_USER_CONTROL_ROUTES.release, adminRoute(exactTab, snapshot)],
]);

export type BrowserUserControlSnapshot = { tabIds: string[] };

/** Decodes the answer of all three routes. */
export function decodeBrowserUserControlSnapshot(input: unknown): BrowserUserControlSnapshot {
  return { tabIds: heldTabIds(isDynamicRecord(input) ? input.tabIds : undefined) };
}

export type BrowserUserControlEvent = {
  type: "browser-user-control-changed";
  tabIds: string[];
};
export function browserUserControlEvent(input: unknown): BrowserUserControlEvent | null {
  if (!isDynamicRecord(input) || input.type !== "browser-user-control-changed") return null;
  return { type: "browser-user-control-changed", tabIds: heldTabIds(input.tabIds) };
}
