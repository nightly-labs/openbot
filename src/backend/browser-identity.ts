// Sites that gate on a browser allowlist and reject an unknown product token: X serves a
// degraded page, and WhatsApp Web refuses to start with "WhatsApp works with Google Chrome
// 100+", which blocks the QR login. They get a plain Chromium identity instead.
const PLAIN_CHROMIUM_DOMAINS = ["x.com", "whatsapp.com"];

export function embeddedBrowserUserAgent(sessionUserAgent: string): string {
  return sessionUserAgent.replace(/\sElectron\/[^\s]+/gu, "");
}

export function embeddedBrowserUserAgentForUrl(sessionUserAgent: string, value: string): string {
  const userAgent = embeddedBrowserUserAgent(sessionUserAgent);
  try {
    if (needsPlainChromiumIdentity(new URL(value).hostname)) {
      return userAgent.replace(/\sOpenBot\/[^\s]+/gu, "");
    }
  } catch {
    // Keep the embedded identity when the navigation URL is not complete yet.
  }
  return userAgent;
}

function needsPlainChromiumIdentity(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PLAIN_CHROMIUM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
