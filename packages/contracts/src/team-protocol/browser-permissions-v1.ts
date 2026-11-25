import type { BrowserLocation, BrowserPermissionAnswer } from "../ipc-browser";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const BROWSER_PERMISSIONS_CAPABILITY = "browser-permissions";
export const BROWSER_PERMISSIONS_ROUTES = {
  state: "/v1/browser/permissions",
  answer: "/v1/browser/permissions/answer",
} as const;

export const BROWSER_LOCATION_ACCURACY_LIMIT = 100_000;
const ORIGIN_LIMIT = 2_048;
const ANSWER_KEYS = new Set(["tabId", "requestId", "allow", "always", "location"]);
const LOCATION_KEYS = new Set(["latitude", "longitude", "accuracyMeters"]);

export type BrowserPermissionRequestState = {
  tabId: string;
  id: string;
  origin: string;
  permission: "geolocation";
};
export type BrowserPermissionsSnapshot = { requests: BrowserPermissionRequestState[] };

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= min && value <= max;
}

export function decodeBrowserLocation(value: unknown): BrowserLocation {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => !LOCATION_KEYS.has(key)) ||
    !isBoundedNumber(value.latitude, -90, 90) ||
    !isBoundedNumber(value.longitude, -180, 180) ||
    !(value.accuracyMeters === null || isBoundedNumber(value.accuracyMeters, 0, BROWSER_LOCATION_ACCURACY_LIMIT))
  )
    throw new Error("Invalid browser location.");
  return { latitude: value.latitude, longitude: value.longitude, accuracyMeters: value.accuracyMeters };
}

export function decodeBrowserPermissionAnswer(value: unknown): BrowserPermissionAnswer {
  if (!isDynamicRecord(value) || Object.keys(value).some((key) => !ANSWER_KEYS.has(key)) || !isBoolean(value.allow))
    throw new Error("Invalid browser permission answer.");
  const tabId = identifier(value.tabId);
  const requestId = identifier(value.requestId);
  if (!isString(tabId) || !isString(requestId)) throw new Error("Invalid browser permission answer.");
  if (value.location !== undefined && !value.allow) throw new Error("Invalid browser permission answer.");
  if (value.always !== undefined && (!isBoolean(value.always) || (value.always && !value.allow)))
    throw new Error("Invalid browser permission answer.");
  return {
    tabId,
    requestId,
    allow: value.allow,
    ...(value.always === true ? { always: true } : {}),
    ...(value.location === undefined ? {} : { location: decodeBrowserLocation(value.location) }),
  };
}

const answerRequest: AdminDecoder = (value) => {
  const answer = decodeBrowserPermissionAnswer(value);
  return {
    tabId: answer.tabId,
    requestId: answer.requestId,
    allow: answer.allow,
    ...(answer.always ? { always: true } : {}),
    ...(answer.location ? { location: { ...answer.location } } : {}),
  };
};
const requestStates = list(
  fields({ tabId: identifier, id: identifier, origin: string(ORIGIN_LIMIT), permission: oneOf("geolocation") }),
  1000,
);
const snapshot = fields({ requests: requestStates });

export const BROWSER_PERMISSIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_PERMISSIONS_ROUTES.state, adminRoute(empty, snapshot)],
  [BROWSER_PERMISSIONS_ROUTES.answer, adminRoute(answerRequest, snapshot)],
]);

function permissionRequests(input: unknown): BrowserPermissionRequestState[] {
  const decoded = requestStates(input);
  if (!Array.isArray(decoded)) throw new Error("Invalid browser permission list.");
  return decoded.flatMap((state) =>
    isDynamicRecord(state) &&
    isString(state.tabId) &&
    isString(state.id) &&
    isString(state.origin) &&
    state.permission === "geolocation"
      ? [{ tabId: state.tabId, id: state.id, origin: state.origin, permission: state.permission }]
      : [],
  );
}

export function decodeBrowserPermissionsSnapshot(input: unknown): BrowserPermissionsSnapshot {
  return { requests: permissionRequests(isDynamicRecord(input) ? input.requests : undefined) };
}

export type BrowserPermissionsEvent = {
  type: "browser-permissions-changed";
  requests: BrowserPermissionRequestState[];
};
export function browserPermissionsEvent(input: unknown): BrowserPermissionsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "browser-permissions-changed") return null;
  return { type: "browser-permissions-changed", requests: permissionRequests(input.requests) };
}
