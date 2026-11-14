// Frozen optional browser-sign-in-storage-v1 wire contract (#8686).
//
// What it grants, recorded here because freezing it makes it permanent: the same as `browser-sign-in`,
// and also the page storage (localStorage) of one site address. Some sites keep the sign-in token in
// the page storage, not in a cookie, so the cookies alone leave the server tab signed out.
// `POST /v1/browser/sign-in/storage` takes `{ tabId, cookies, storage }`. `storage` is null, or the
// origin of the page that the sign-in window showed and its pairs. The host sets the cookies as
// `browser-sign-in` does, writes the pairs only when the tab shows that same origin, and loads the
// page again. It answers with the count of cookies and pairs that it set. The host never sends the
// values back and never records them. Widening any of it needs another capability string.
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

/**
 * The characters of all names and values together. With 150 cookies of 4096 characters, the body
 * stays under the 1 MiB limit of the host.
 */
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
/** An http(s) origin with no path, and at most the text limit in all names and values together. */
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

/** The page storage of one origin. A name or a value can be any text. */
export type BrowserSignInStorage = { origin: string; entries: { name: string; value: string }[] };
export type BrowserSignInStorageImport = {
  tabId: string;
  cookies: BrowserSignInCookie[];
  storage: BrowserSignInStorage | null;
};
export type BrowserSignInStorageResult = { cookies: number; storage: number };

/** An http(s) origin with no path, as `URL.origin` gives it. */
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

/** What the host route reads, after the codec checked the wire. */
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

/** The host's answer. */
export function decodeBrowserSignInStorageResult(input: unknown): BrowserSignInStorageResult {
  const decoded = importResponse(input);
  if (!isDynamicRecord(decoded) || typeof decoded.cookies !== "number" || typeof decoded.storage !== "number")
    throw new Error("Invalid browser sign-in result.");
  return { cookies: decoded.cookies, storage: decoded.storage };
}
