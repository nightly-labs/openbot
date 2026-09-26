import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { sourceText } from "@openbot/i18n/source";
import { app } from "electron";
import { applySiteIdentity } from "./browser-identity";
import { isPersistableBrowserUrl } from "./browser-state";

export function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error(sourceText("error.backend.browserUrlRequired"));
  if (value.length > INPUT_LIMITS.browserUrl) throw new Error(sourceText("error.backend.browserUrlTooLong"));
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(sourceText("error.backend.browserUrlProtocol"));
  }
  return url.toString();
}

export function browserLoadOptions(): { extraHeaders: string } {
  return { extraHeaders: "Cache-Control: no-cache\nPragma: no-cache" };
}

export function browserRequestHeaders(url: string, requestHeaders: Record<string, string>): Record<string, string> {
  const headers = applySiteIdentity(url, requestHeaders);
  setRequestHeader(headers, "Accept-Language", preferredBrowserLanguages());
  return headers;
}

function preferredBrowserLanguages(): string {
  return preferredBrowserLanguageCodes()
    .split(",")
    .map((language, index) => (index === 0 ? language : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`))
    .join(",");
}

export function preferredBrowserLanguageCodes(): string {
  const languages = app.getPreferredSystemLanguages();
  return (languages.length > 0 ? languages : [app.getLocale()]).join(",");
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): void {
  const existingName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (existingName && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

export function isAllowedMainUrl(value: string): boolean {
  return value === "about:blank" || isPersistableBrowserUrl(value);
}

/**
 * The embedded browser grants exactly one page permission: writing plain, sanitized content to the
 * clipboard. Chromium only asks for it behind a user gesture, which is what a page's own "copy
 * link" button is, and refusing it left such a button silently doing nothing. Reading the clipboard
 * stays refused -- a page must never see what the user copied elsewhere -- and so does everything
 * else, so camera, microphone, location and notifications are unchanged.
 */
export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

/**
 * The host of a tab's URL, for a log line. `diagnosticUrl` below keeps the path, which is right for a
 * diagnostic the user reads back in the app but wrong for a log: a path carries tokens often enough
 * (`/reset/<secret>`, `/invite/<secret>`) that writing one to disk breaks the redaction rule. The host
 * is enough to tell which tab an agent closed.
 */
export function logUrlHost(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

export function diagnosticUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, INPUT_LIMITS.browserUrl);
  } catch {
    return undefined;
  }
}
