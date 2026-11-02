// Frozen optional browser-page-state wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member stops the
// load of a host browser tab that the member can see, and learns whether each such tab can go back
// or forward in its history. Each change sends `browser-page-state-changed` with the state of every
// tab that the member can see. Both routes answer with that list. A stop of a tab that does not load
// changes nothing. Bounds and meaning do not follow IPC changes; widening any of it needs a second
// capability string.
import { isBoolean, isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
} from "./admin-wire";

export const BROWSER_PAGE_STATE_CAPABILITY = "browser-page-state";
export const BROWSER_PAGE_STATE_ROUTES = {
  state: "/v1/browser/page-state",
  stop: "/v1/browser/stop",
} as const;

const exactTab: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "tabId"))
    throw new Error("Invalid browser page state request.");
  return fields({ tabId: identifier })(input);
};
const tabStates = list(fields({ tabId: identifier, canGoBack: boolean, canGoForward: boolean }), 1000);
const snapshot = fields({ tabs: tabStates });

export const BROWSER_PAGE_STATE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_PAGE_STATE_ROUTES.state, adminRoute(empty, snapshot)],
  [BROWSER_PAGE_STATE_ROUTES.stop, adminRoute(exactTab, snapshot)],
]);

export type BrowserPageState = { tabId: string; canGoBack: boolean; canGoForward: boolean };
export type BrowserPageStateSnapshot = { tabs: BrowserPageState[] };

function pageStates(input: unknown): BrowserPageState[] {
  const decoded = tabStates(input);
  if (!Array.isArray(decoded)) throw new Error("Invalid browser page state list.");
  return decoded.flatMap((state) =>
    isDynamicRecord(state) && isString(state.tabId) && isBoolean(state.canGoBack) && isBoolean(state.canGoForward)
      ? [{ tabId: state.tabId, canGoBack: state.canGoBack, canGoForward: state.canGoForward }]
      : [],
  );
}

/** Decodes the answer of both routes. */
export function decodeBrowserPageStateSnapshot(input: unknown): BrowserPageStateSnapshot {
  return { tabs: pageStates(isDynamicRecord(input) ? input.tabs : undefined) };
}

export type BrowserPageStateEvent = {
  type: "browser-page-state-changed";
  tabs: BrowserPageState[];
};
export function browserPageStateEvent(input: unknown): BrowserPageStateEvent | null {
  if (!isDynamicRecord(input) || input.type !== "browser-page-state-changed") return null;
  return { type: "browser-page-state-changed", tabs: pageStates(input.tabs) };
}
