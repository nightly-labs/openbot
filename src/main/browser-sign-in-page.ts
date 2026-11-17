import { browserSignInCookieFitsHost } from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import { getDomain } from "tldts";

/** Words in a path or a query that sign-in, sign-up and recovery steps of most sites use. */
const SIGN_IN_WORD =
  /(?:^|[^a-z])(?:log-?in|sign-?in|sign-?up|auth\w*|flow|challenge|verify|verification|2fa|mfa|otp|password|register|reset|recover\w*|forgot|checkpoint|access|sso|session)(?:$|[^a-z])/iu;

function parsedUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

/** True when the address looks like a step of a sign-in. A guess: the caller must also check cookies. */
export function isBrowserSignInAddress(url: string): boolean {
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  return SIGN_IN_WORD.test(parsed.pathname) || SIGN_IN_WORD.test(parsed.search);
}

/**
 * True when the page is on the site of the sign-in: the same host, a parent domain, a subdomain, or
 * another subdomain of the same registrable domain. Some sites sign in on one subdomain and then show
 * the signed-in page on another, such as `auth.leboncoin.fr` and `www.leboncoin.fr` (#11219).
 * Private suffixes such as `github.io` keep their subdomains apart.
 */
export function isBrowserSignInSite(url: string, host: string): boolean {
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  if (browserSignInCookieFitsHost(parsed.hostname, host)) return true;
  const site = getDomain(host, { allowPrivateDomains: true });
  return site !== null && site === getDomain(parsed.hostname, { allowPrivateDomains: true });
}

/** The site shows a page after the sign-in: on the same site, and not a step of the sign-in. */
export function isBrowserSignedInPage(url: string, host: string): boolean {
  return isBrowserSignInSite(url, host) && !isBrowserSignInAddress(url);
}
