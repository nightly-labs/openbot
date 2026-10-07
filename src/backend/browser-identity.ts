/**
 * Per-site request identity for the embedded browser.
 *
 * One shared session means one page identity: the Chromium string with its `Electron/` build
 * token, which Google reads as a known client, but without the `OpenBot/` product token, which
 * Framer's sign-in policy refuses from page JavaScript. A few allowlists also refuse the build
 * token, so those hosts get it scrubbed out, request by request. Page JavaScript always sees
 * the session string; only listed hosts are ever rewritten, so one host's gate cannot change
 * another's verdict.
 *
 * To add a site: append a row with the measured reason and cover it with an opt-in live
 * probe in `scripts/browser-smoke-electron.ts` (`--*-live`), the way WhatsApp is covered.
 * The first match in table order wins, and anything unmatched stays native.
 */
export type BrowserSiteIdentity = "native" | "scrubbed";

interface BrowserSitePolicy {
  readonly hosts: readonly string[];
  readonly identity: BrowserSiteIdentity;
  readonly reason: string;
}

const SITE_POLICIES: readonly BrowserSitePolicy[] = [
  {
    hosts: ["whatsapp.com", "whatsapp.net"],
    identity: "scrubbed",
    reason: "Allowlist refuses the build token; measured with --whatsapp-live.",
  },
  {
    hosts: ["canva.com"],
    identity: "scrubbed",
    reason: "Server answers the product token with an update-your-browser page; measured with --canva-live.",
  },
];

export function siteIdentityForUrl(url: string): BrowserSiteIdentity {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/\.+$/u, "");
  } catch {
    return "native";
  }
  for (const policy of SITE_POLICIES) {
    if (policy.hosts.some((base) => hostname === base || hostname.endsWith(`.${base}`))) {
      return policy.identity;
    }
  }
  return "native";
}

/**
 * The session identity: the native string without the app product token. Removing the build
 * token as well made Google refuse sign-in (`--google-live`); keeping the product token made
 * Framer answer every sign-in with "Access denied by policy" (`--framer-live`).
 */
export function sessionBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/\sOpenBot\/[^\s]+/gu, "");
}

export function scrubbedBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/\s(?:Electron|OpenBot)\/[^\s]+/gu, "");
}

/**
 * The request headers with the site policy applied. Returns a copy; the input is never
 * mutated. Hosts outside the table pass through untouched, as does a request without a
 * user agent -- no header is ever invented.
 */
export function applySiteIdentity(url: string, requestHeaders: Record<string, string>): Record<string, string> {
  const headers = { ...requestHeaders };
  if (siteIdentityForUrl(url) !== "scrubbed") return headers;
  const userAgent = Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === "user-agent");
  if (userAgent === undefined) return headers;
  const [userAgentName, userAgentValue] = userAgent;
  const scrubbed = scrubbedBrowserUserAgent(userAgentValue);
  if (userAgentName !== "User-Agent") delete headers[userAgentName];
  headers["User-Agent"] = scrubbed;
  return headers;
}
