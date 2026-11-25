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

export interface BrowserTeachWireStep {
  kind: "page" | "click";
  host: string;
  path: string;
  title?: string;
  role?: string;
  name?: string;
}

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
