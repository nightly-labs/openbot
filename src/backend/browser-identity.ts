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
 * Rows never overlap by construction: the first match in table order wins, and the
 * fallback below the table stays native.
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
    hostname = new URL(url).hostname;
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
