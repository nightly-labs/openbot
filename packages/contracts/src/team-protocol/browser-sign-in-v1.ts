import { isBoolean, isDynamicRecord, isOneOf, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { mapBrowserTakeoverRequests } from "./browser-secret-v1";
import type { TeamProtocolV4BaseJsonValue } from "./v4-base";

export const BROWSER_SIGN_IN_CAPABILITY = "browser-sign-in";
export const BROWSER_SIGN_IN_ROUTES = {
  import: "/v1/browser/sign-in",
} as const;

const TAKEOVER_REASONS = ["sign-in-blocked"] as const;
const SAME_SITE = ["unspecified", "no_restriction", "lax", "strict"] as const;
const cookie = fields({
  name: string(4096),
  value: string(4096),
  domain: string(253),
  path: string(1024),
  secure: boolean,
  httpOnly: boolean,
  sameSite: oneOf(...SAME_SITE),
  expirationDate: nullable(count),
});
const importRequest: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "tabId" && key !== "cookies"))
    throw new Error("Invalid browser sign-in request.");
  return fields({ tabId: identifier, cookies: list(cookie, 150) })(input);
};
const importResponse = fields({ cookies: count });
export const browserSignInCookieCodec = cookie;

export const BROWSER_SIGN_IN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_SIGN_IN_ROUTES.import, adminRoute(importRequest, importResponse)],
]);

export type BrowserSignInCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: (typeof SAME_SITE)[number];
  expirationDate: number | null;
};
export type BrowserSignInImport = { tabId: string; cookies: BrowserSignInCookie[] };
export type BrowserSignInResult = { cookies: number };

export function decodeBrowserSignInResult(input: unknown): BrowserSignInResult {
  const decoded = importResponse(input);
  if (!isDynamicRecord(decoded) || typeof decoded.cookies !== "number")
    throw new Error("Invalid browser sign-in result.");
  return { cookies: decoded.cookies };
}

function sameSite(value: unknown): BrowserSignInCookie["sameSite"] {
  const match = SAME_SITE.find((choice) => choice === value);
  if (!match) throw new Error("Invalid browser sign-in cookie.");
  return match;
}
function signInCookie(value: unknown): BrowserSignInCookie {
  const decoded = cookie(value);
  if (
    !isDynamicRecord(decoded) ||
    !isString(decoded.name) ||
    !isString(decoded.value) ||
    !isString(decoded.domain) ||
    !isString(decoded.path) ||
    !isBoolean(decoded.secure) ||
    !isBoolean(decoded.httpOnly)
  )
    throw new Error("Invalid browser sign-in cookie.");
  return {
    name: decoded.name,
    value: decoded.value,
    domain: decoded.domain,
    path: decoded.path,
    secure: decoded.secure,
    httpOnly: decoded.httpOnly,
    sameSite: sameSite(decoded.sameSite),
    expirationDate: typeof decoded.expirationDate === "number" ? decoded.expirationDate : null,
  };
}

export function decodeBrowserSignInImport(input: unknown): BrowserSignInImport {
  if (!isDynamicRecord(input) || !Array.isArray(input.cookies) || input.cookies.length > 150)
    throw new Error("Invalid browser sign-in request.");
  return { tabId: String(identifier(input.tabId)), cookies: input.cookies.map(signInCookie) };
}

const COOKIE_DOMAIN = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/u;

export function browserSignInCookieFitsHost(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.replace(/^\./u, "").toLowerCase();
  const page = host.toLowerCase();
  if (!COOKIE_DOMAIN.test(domain) || !page) return false;
  return domain === page || (domain.includes(".") && page.endsWith(`.${domain}`)) || domain.endsWith(`.${page}`);
}

export function restoreBrowserTakeoverReason(
  projected: TeamProtocolV4BaseJsonValue,
  source: unknown,
): TeamProtocolV4BaseJsonValue {
  return mapBrowserTakeoverRequests(projected, source, (target, request) => {
    if (!isDynamicRecord(target) || !isDynamicRecord(request) || request.reason === undefined) return target;
    if (!isOneOf(TAKEOVER_REASONS, request.reason)) throw new Error("Invalid browser takeover reason.");
    return { ...target, reason: request.reason };
  });
}
