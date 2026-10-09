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
  const hostname = new URL(url).hostname.replace(/\.+$/u, "");
  if (hostname !== "accounts.google.com") return cleanAgent;
  return cleanAgent.replace(/(Chrome\/[^\s]+)/u, `$1 Electron/${electronVersion}`);
}

/** Electron has native navigator.userAgentData, but does not send client-hint headers. */
export function browserClientHints(chromeVersion: string, platform: NodeJS.Platform): Record<string, string> {
  const platformName = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
  return {
    "Sec-CH-UA": `"Chromium";v="${chromeVersion.split(".")[0]}"`,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"${platformName}"`,
  };
}
