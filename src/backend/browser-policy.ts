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
  requestedHints?: ReadonlySet<string>,
): Record<string, string> {
  const headers = { ...requestHeaders };
  const userAgent = Object.entries(headers).find(([name]) => name.toLowerCase() === "user-agent");
  if (userAgent) {
    setRequestHeader(headers, "User-Agent", browserRequestUserAgent(url, userAgent[1], process.versions.electron));
  }
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

export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write" || permission === "storage-access";
}

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
