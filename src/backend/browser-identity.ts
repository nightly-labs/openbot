/**
 * Per-site request identity for the embedded browser.
 *
 * The session keeps its native identity everywhere: Google reads a scrubbed Chromium string
 * as an unknown client and refuses sign-in. A few allowlists read the other way -- WhatsApp
 * Web refuses to start when the agent carries the build token. Those hosts get the tokens
 * scrubbed back out, request by request. Page JavaScript always sees the native string;
 * only listed hosts are ever rewritten, so one host's gate cannot change another's verdict.
 */
const SCRUBBED_IDENTITY_HOSTS = ["whatsapp.com", "whatsapp.net"];

export function requiresScrubbedIdentity(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return SCRUBBED_IDENTITY_HOSTS.some((base) => hostname === base || hostname.endsWith(`.${base}`));
}

export function scrubbedBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/\s(?:Electron|OpenBot)\/[^\s]+/gu, "");
}
