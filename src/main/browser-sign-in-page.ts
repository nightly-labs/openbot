import { browserSignInCookieFitsHost } from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import { getDomain } from "tldts";

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

function isBrowserSignInAddress(url: string): boolean {
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  return SIGN_IN_WORD.test(parsed.pathname) || SIGN_IN_WORD.test(parsed.search);
}

function isBrowserSignInSite(url: string, host: string): boolean {
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  if (browserSignInCookieFitsHost(parsed.hostname, host)) return true;
  const site = getDomain(host, { allowPrivateDomains: true });
  return site !== null && site === getDomain(parsed.hostname, { allowPrivateDomains: true });
}

export function isBrowserSignedInPage(url: string, host: string): boolean {
  return isBrowserSignInSite(url, host) && !isBrowserSignInAddress(url);
}
