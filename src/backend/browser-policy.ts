import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { sourceText } from "@openbot/i18n/source";
import { app } from "electron";
import { browserClientHints, browserHighEntropyClientHints, browserRequestUserAgent } from "./browser-identity";
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

export function browserRequestHeaders(
  url: string,
  requestHeaders: Record<string, string>,
  /** The lower-case hint names that the origin asked for with `Accept-CH`. */
  requestedHints?: ReadonlySet<string>,
): Record<string, string> {
  const headers = { ...requestHeaders };
  const userAgent = Object.entries(headers).find(([name]) => name.toLowerCase() === "user-agent");
  if (userAgent) {
    setRequestHeader(headers, "User-Agent", browserRequestUserAgent(url, userAgent[1], process.versions.electron));
  }
  // Send the low-entropy hints, and the hints the origin asked for, on secure origins. Keep any
  // hints Chromium supplies.
  const target = URL.parse(url);
  if (
    target?.protocol === "https:" ||
    (target?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
  ) {
    const requested = requestedHints
      ? Object.entries(
          browserHighEntropyClientHints({
            chromeVersion: process.versions.chrome,
            platform: process.platform,
            arch: process.arch,
            systemVersion: process.getSystemVersion(),
          }),
        ).filter(([name]) => requestedHints.has(name.toLowerCase()))
      : [];
    for (const [name, value] of [
      ...Object.entries(browserClientHints(process.versions.chrome, process.platform)),
      ...requested,
    ]) {
      if (!Object.keys(headers).some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
        headers[name] = value;
      }
    }
  }
  return headers;
}

/**
 * The languages of the `Accept-Language` header, for `session.setUserAgent`. Chromium adds the
 * q-values, and sends the header only on a request that has none: a value that the page set stays,
 * because a site can sign it (#8272). As Chrome does, each language with a region also gives its
 * base language, after the last language of that base: `en-GB` gives `en-GB,en;q=0.9`.
 * `navigator.languages` does not read this list, so it has no added base languages, also as in Chrome.
 */
export function preferredBrowserLanguageCodes(): string {
  const languages = app.getPreferredSystemLanguages();
  const codes = languages.length > 0 ? languages : [app.getLocale()];
  const base = (code: string) => code.split("-")[0] ?? code;
  const expanded: string[] = [];
  for (const [index, code] of codes.entries()) {
    if (!expanded.includes(code)) expanded.push(code);
    const next = codes[index + 1];
    if (code.includes("-") && (next === undefined || base(next) !== base(code)) && !expanded.includes(base(code)))
      expanded.push(base(code));
  }
  return expanded.join(",");
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
 * The embedded browser grants two page permissions. The first is writing plain, sanitized content
 * to the clipboard. Chromium only asks for it behind a user gesture, which is what a page's own
 * "copy link" button is, and refusing it left such a button silently doing nothing. Reading the
 * clipboard stays refused -- a page must never see what the user copied elsewhere -- and so does
 * everything other than the two, so camera, microphone, location and notifications are unchanged.
 *
 * The second is `storage-access`. It is not a new right: the session already sends a frame of another site its
 * cookies. Chrome grants the Storage Access API in that state, and a refusal made
 * `requestStorageAccess()` fail in a frame such as a Google picker (#8298).
 * `top-level-storage-access` stays refused: Chrome grants it only in a Related Website Set.
 */
export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write" || permission === "storage-access";
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
