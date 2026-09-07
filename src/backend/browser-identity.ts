/**
 * The embedded browser presents a plain Chromium identity: no `Electron/` build token, and no app
 * product token either. `navigator.userAgentData.brands` never carried the product, so a page that
 * read both saw the two disagree, and a site that gates on a browser allowlist reads that as an
 * unsupported browser -- X served a degraded page, and WhatsApp Web refused to start at all, which
 * blocked the QR login. One identity for every site and every subresource, set once on the session.
 */
export function embeddedBrowserUserAgent(sessionUserAgent: string): string {
  return sessionUserAgent.replace(/\s(?:Electron|OpenBot)\/[^\s]+/gu, "");
}
