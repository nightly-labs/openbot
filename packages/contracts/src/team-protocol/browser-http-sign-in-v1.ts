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

export type BrowserHttpSignInPrompt = { tabId: string; origin: string; refused: boolean };
export type BrowserHttpSignInSnapshot = { tabs: BrowserHttpSignInPrompt[] };
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
  return decoded.map((entry) => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.tabId) ||
      !isString(entry.origin) ||
      !httpsOrigin(entry.origin) ||
      !isBoolean(entry.refused)
    )
      throw new Error("Invalid browser HTTP sign-in prompt.");
    return { tabId: entry.tabId, origin: entry.origin, refused: entry.refused };
  });
}

export function decodeBrowserHttpSignInSnapshot(input: unknown): BrowserHttpSignInSnapshot {
  return { tabs: signInPrompts(isDynamicRecord(input) ? input.tabs : undefined) };
}

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
