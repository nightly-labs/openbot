import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { type BrowserSignInCookie, browserSignInCookieCodec, decodeBrowserSignInImport } from "./browser-sign-in-v1";

export const BROWSER_SIGN_IN_STORAGE_CAPABILITY = "browser-sign-in-storage-v1";
export const BROWSER_SIGN_IN_STORAGE_ROUTES = {
  import: "/v1/browser/sign-in/storage",
} as const;

export const BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT = 256 * 1024;
export const BROWSER_SIGN_IN_STORAGE_ENTRY_LIMIT = 1000;
const ORIGIN_LIMIT = 300;

const entry = fields({
  name: string(BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT),
  value: string(BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT),
});
const storageFields = fields({
  origin: string(ORIGIN_LIMIT),
  entries: list(entry, BROWSER_SIGN_IN_STORAGE_ENTRY_LIMIT),
});
const storage: AdminDecoder = (input) => {
  const decoded = storageFields(input);
  if (
    !isDynamicRecord(decoded) ||
    !isString(decoded.origin) ||
    !isBrowserSignInOrigin(decoded.origin) ||
    !Array.isArray(decoded.entries) ||
    storageText(decoded.entries) > BROWSER_SIGN_IN_STORAGE_TEXT_LIMIT
  )
    throw new Error("Invalid browser sign-in storage.");
  return decoded;
};
const importRequest: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !["tabId", "cookies", "storage"].includes(key)))
    throw new Error("Invalid browser sign-in request.");
  return fields({ tabId: identifier, cookies: list(browserSignInCookieCodec, 150), storage: nullable(storage) })(input);
};
const importResponse = fields({ cookies: count, storage: count });

export const BROWSER_SIGN_IN_STORAGE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_SIGN_IN_STORAGE_ROUTES.import, adminRoute(importRequest, importResponse)],
]);

export type BrowserSignInStorage = { origin: string; entries: { name: string; value: string }[] };
export type BrowserSignInStorageImport = {
  tabId: string;
  cookies: BrowserSignInCookie[];
  storage: BrowserSignInStorage | null;
};
export type BrowserSignInStorageResult = { cookies: number; storage: number };

export function isBrowserSignInOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
}

function storageText(entries: readonly unknown[]): number {
  return entries.reduce<number>(
    (total, item) =>
      total +
      (isDynamicRecord(item) && isString(item.name) && isString(item.value) ? item.name.length + item.value.length : 0),
    0,
  );
}

export function decodeBrowserSignInStorageImport(input: unknown): BrowserSignInStorageImport {
  if (!isDynamicRecord(input)) throw new Error("Invalid browser sign-in request.");
  const signIn = decodeBrowserSignInImport({ tabId: input.tabId, cookies: input.cookies });
  if (input.storage === null) return { ...signIn, storage: null };
  const value = input.storage;
  if (!isDynamicRecord(value) || !isString(value.origin) || !Array.isArray(value.entries))
    throw new Error("Invalid browser sign-in storage.");
  const entries = value.entries.map((item: unknown) => {
    if (!isDynamicRecord(item) || !isString(item.name) || !isString(item.value))
      throw new Error("Invalid browser sign-in storage.");
    return { name: item.name, value: item.value };
  });
  return { ...signIn, storage: { origin: value.origin, entries } };
}

export function decodeBrowserSignInStorageResult(input: unknown): BrowserSignInStorageResult {
  const decoded = importResponse(input);
  if (!isDynamicRecord(decoded) || typeof decoded.cookies !== "number" || typeof decoded.storage !== "number")
    throw new Error("Invalid browser sign-in result.");
  return { cookies: decoded.cookies, storage: decoded.storage };
}
