// Frozen optional browser-teach-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member shows a
// task in a host browser tab that the member can see and that an agent owns. `start` takes control of
// the tab for the member, as `browser-user-control` does, and the host then records the pages that
// load and the controls that the member clicks in that tab: the host and the path of the page without
// the query and the hash, its title, and the role and the name of each clicked control. It never
// records typed text. The recording ends when the control of the tab ends, after 10 minutes or at 200
// steps. `stop` with `save` gives the steps to the session that started the recording, and only to
// that session; any other member who can see the tab gets an empty list. `stop` always deletes the
// recording and releases the tab. The host keeps the steps in memory only, and refuses `start` for a
// tab with no agent, a private tab, or a tab with an active secret request. A protocol 9 capability
// only. Bounds and meaning do not follow IPC changes; widening any of it needs a second capability
// string.
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const BROWSER_TEACH_CAPABILITY = "browser-teach-v1";
export const BROWSER_TEACH_ROUTES = {
  start: "/v1/browser/teach/start",
  stop: "/v1/browser/teach/stop",
} as const;

/** The most steps of one recording. */
export const BROWSER_TEACH_MAX_STEPS = 200;

const exactFields =
  (decode: AdminDecoder, ...keys: string[]): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !keys.includes(key)))
      throw new Error("Invalid browser teach request.");
    return decode(input);
  };
const text = string(120);
const step = fields({ kind: oneOf("page", "click"), host: text, path: text }, { title: text, role: text, name: text });
const steps = fields({ steps: list(step, BROWSER_TEACH_MAX_STEPS) });

export const BROWSER_TEACH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_TEACH_ROUTES.start, adminRoute(exactFields(fields({ tabId: identifier }), "tabId"), empty)],
  [
    BROWSER_TEACH_ROUTES.stop,
    adminRoute(exactFields(fields({ tabId: identifier, save: boolean }), "tabId", "save"), steps),
  ],
]);

/** One thing that the person did: a page that loaded, or a click on a control. No typed text. */
export interface BrowserTeachWireStep {
  kind: "page" | "click";
  host: string;
  path: string;
  title?: string;
  role?: string;
  name?: string;
}

/** Decodes the answer of `stop`. */
export function decodeBrowserTeachSteps(input: unknown): BrowserTeachWireStep[] {
  const decoded = steps(input);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.steps)) throw new Error("Invalid browser teach steps.");
  return decoded.steps.flatMap((value) => {
    if (!isDynamicRecord(value) || !isString(value.host) || !isString(value.path)) return [];
    return [
      {
        kind: value.kind === "click" ? ("click" as const) : ("page" as const),
        host: value.host,
        path: value.path,
        ...(isString(value.title) ? { title: value.title } : {}),
        ...(isString(value.role) ? { role: value.role } : {}),
        ...(isString(value.name) ? { name: value.name } : {}),
      },
    ];
  });
}
