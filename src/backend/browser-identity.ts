/**
 * Per-site request identity for the embedded browser.
 *
 * One shared session means one page identity: native everywhere, which Google reads as a
 * known client. A few allowlists read the other way, so those hosts get the build and
 * product tokens scrubbed back out, request by request. Page JavaScript always sees the
 * native string; only listed hosts are ever rewritten, so one host's gate cannot change
 * another's verdict.
 *
 * To add a site: append a row with the measured reason and cover it with an opt-in live
 * probe in `scripts/browser-smoke-electron.ts` (`--*-live`), the way WhatsApp is covered.
 * The first match in table order wins, and anything unmatched stays native.
 */
export type BrowserSiteIdentity = "native" | "scrubbed";

export interface BrowserSitePolicy {
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
  const userAgentName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === "user-agent");
  if (userAgentName === undefined) return headers;
  const scrubbed = scrubbedBrowserUserAgent(headers[userAgentName]);
  if (userAgentName !== "User-Agent") delete headers[userAgentName];
  headers["User-Agent"] = scrubbed;
  return headers;
}
