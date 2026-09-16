/**
 * Google login state for the embedded browser.
 *
 * Google can refuse one login step in an embedded view with
 * `/signin/rejected` or `disallowed_useragent`. The check uses the tab URL
 * only, so it runs in the renderer without page text or a contract change.
 */
export const GOOGLE_AUTH_BLOCKED_MESSAGE =
  "Google blocked this login step. Log in at accounts.google.com in this browser first. Then return here and reload the page.";

export function isGoogleBlockUrl(url: string): boolean {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return url.includes("/signin/rejected") || url.includes("disallowed_useragent");
  }
  if (parsed.hostname !== "accounts.google.com") return false;
  if (parsed.pathname.includes("/signin/rejected")) return true;
  return `${parsed.search}${parsed.hash}`.toLowerCase().includes("disallowed_useragent");
}

export function googleAuthBlockedMessage(url: string | undefined): string | null {
  if (!url) return null;
  return isGoogleBlockUrl(url) ? GOOGLE_AUTH_BLOCKED_MESSAGE : null;
}
