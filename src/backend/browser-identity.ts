/** The browser keeps the installed Chromium version and host platform. */
export function sessionBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/\s(?:Electron|OpenBot)\/[^\s]+/gu, "");
}

/**
 * Google currently rejects its account identifier step without the Electron token.
 * Keep this exception on Google account requests; other sites use the session identity.
 */
export function browserRequestUserAgent(url: string, userAgent: string, electronVersion: string): string {
  const cleanAgent = sessionBrowserUserAgent(userAgent);
  // Chromium requests some URLs that Node cannot parse, such as a host with an escaped space (#3775).
  const hostname = URL.parse(url)?.hostname.replace(/\.+$/u, "");
  if (hostname !== "accounts.google.com") return cleanAgent;
  return cleanAgent.replace(/(Chrome\/[^\s]+)/u, `$1 Electron/${electronVersion}`);
}

const GREASE_CHARACTERS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"] as const;
const GREASE_VERSIONS = ["8", "99", "24"] as const;

/**
 * The brands of `navigator.userAgentData`, in Chromium's order: a GREASE brand and Chromium,
 * both chosen by the major version (`GenerateBrandVersionList` in Chromium's
 * `components/embedder_support/user_agent_utils.cc`). Cloudflare rejects a header that names
 * different brands than the page reads, even when a person solves the challenge.
 */
function browserBrandHeader(majorVersion: number): string {
  const grease = `"Not${GREASE_CHARACTERS[majorVersion % GREASE_CHARACTERS.length]}A${
    GREASE_CHARACTERS[(majorVersion + 1) % GREASE_CHARACTERS.length]
  }Brand";v="${GREASE_VERSIONS[majorVersion % GREASE_VERSIONS.length]}"`;
  const chromium = `"Chromium";v="${majorVersion}"`;
  return majorVersion % 2 === 0 ? `${grease}, ${chromium}` : `${chromium}, ${grease}`;
}

/** Electron has native navigator.userAgentData, but does not send client-hint headers. */
export function browserClientHints(chromeVersion: string, platform: NodeJS.Platform): Record<string, string> {
  const platformName = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
  return {
    "Sec-CH-UA": browserBrandHeader(Number.parseInt(chromeVersion, 10)),
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"${platformName}"`,
  };
}
