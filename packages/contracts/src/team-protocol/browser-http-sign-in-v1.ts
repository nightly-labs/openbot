// Frozen optional browser HTTP sign-in wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can see
// a host browser tab answers the sign-in prompt that the site of that tab shows itself (HTTP Basic or
// Digest), with a username and a password. The host asks only for a page load over HTTPS, never for a
// proxy. It keeps the answer in memory for one try at the same site and realm, loads the page again,
// and forgets the answer after that try. The host never sends the answer back and never records it.
// `refused` says that the site did not accept the last answer. Bounds and meaning do not follow IPC
// changes; widening any of it needs a second capability string.
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
  string,
} from "./admin-wire";

export const BROWSER_HTTP_SIGN_IN_CAPABILITY = "browser-http-sign-in";
export const BROWSER_HTTP_SIGN_IN_ROUTES = {
  state: "/v1/browser/http-sign-in",
  answer: "/v1/browser/http-sign-in/answer",
} as const;

export const BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT = 1024;
export const BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT = 4096;

const prompt = fields({ tabId: identifier, origin: string(2048), refused: boolean });
const prompts = list(prompt, 1000);
const snapshot = fields({ tabs: prompts });
const answerRequest: AdminDecoder = (input) => {
  if (!isDynamicRecord(input)) throw new Error("Invalid browser HTTP sign-in answer.");
  const keys = Object.keys(input);
  if (input.cancel === true && keys.every((key) => key === "tabId" || key === "cancel"))
    return fields({ tabId: identifier, cancel: boolean })(input);
  if (keys.some((key) => key !== "tabId" && key !== "username" && key !== "password"))
    throw new Error("Invalid browser HTTP sign-in answer.");
  return fields({
    tabId: identifier,
    username: string(BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT),
    password: string(BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT),
  })(input);
};

export const BROWSER_HTTP_SIGN_IN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_HTTP_SIGN_IN_ROUTES.state, adminRoute(empty, snapshot)],
  [BROWSER_HTTP_SIGN_IN_ROUTES.answer, adminRoute(answerRequest, snapshot)],
]);

/** A site's own sign-in prompt in a tab. */
export type BrowserHttpSignInPrompt = { tabId: string; origin: string; refused: boolean };
export type BrowserHttpSignInSnapshot = { tabs: BrowserHttpSignInPrompt[] };
/** `cancel` closes the prompt; the page keeps what the site sent without a sign-in. */
export type BrowserHttpSignInAnswer = { tabId: string } & ({ username: string; password: string } | { cancel: true });

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function signInPrompts(input: unknown): BrowserHttpSignInPrompt[] {
  const decoded = prompts(input);
  if (!Array.isArray(decoded)) throw new Error("Invalid browser HTTP sign-in list.");
  return decoded.flatMap((entry) =>
    isDynamicRecord(entry) &&
    isString(entry.tabId) &&
    isString(entry.origin) &&
    httpsOrigin(entry.origin) &&
    isBoolean(entry.refused)
      ? [{ tabId: entry.tabId, origin: entry.origin, refused: entry.refused }]
      : [],
  );
}

export function decodeBrowserHttpSignInSnapshot(input: unknown): BrowserHttpSignInSnapshot {
  return { tabs: signInPrompts(isDynamicRecord(input) ? input.tabs : undefined) };
}

/** Never include the rejected payload in validation errors. */
export function decodeBrowserHttpSignInAnswer(input: unknown): BrowserHttpSignInAnswer {
  let decoded: unknown;
  try {
    decoded = answerRequest(input);
  } catch {
    throw new Error("Invalid browser HTTP sign-in answer.");
  }
  if (!isDynamicRecord(decoded) || !isString(decoded.tabId)) throw new Error("Invalid browser HTTP sign-in answer.");
  if (decoded.cancel === true) return { tabId: decoded.tabId, cancel: true };
  if (!isString(decoded.username) || !isString(decoded.password))
    throw new Error("Invalid browser HTTP sign-in answer.");
  return { tabId: decoded.tabId, username: decoded.username, password: decoded.password };
}

export type BrowserHttpSignInEvent = {
  type: "browser-http-sign-in-changed";
  tabs: BrowserHttpSignInPrompt[];
};
export function browserHttpSignInEvent(input: unknown): BrowserHttpSignInEvent | null {
  if (!isDynamicRecord(input) || input.type !== "browser-http-sign-in-changed") return null;
  return { type: "browser-http-sign-in-changed", tabs: signInPrompts(input.tabs) };
}
