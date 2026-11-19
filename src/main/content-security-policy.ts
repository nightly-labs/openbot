import { isMobileConnectDevelopmentHost } from "@openbot/contracts/mobile-connect";

export function buildContentSecurityPolicy(
  packaged: boolean,
  developmentSignalUrl?: string,
  selfHostedSignalOrigin?: string | null,
): string {
  const selfHostedSignalSource = selfHostedSignalOrigin ? ` ${selfHostedSignalOrigin}` : "";
  const developmentSources = packaged
    ? ""
    : ` http://localhost:* ws://localhost:*${developmentSignalSource(developmentSignalUrl)}`;
  const developmentImageSources = packaged ? "" : " http://127.0.0.1:* http://localhost:*";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: openbot-attachment: openbot-remote-attachment: openbot-avatar: openbot-remote-avatar: openbot-server-logo: openbot-remote-server-logo: https:${developmentImageSources}`,
    "font-src 'self' data:",
    "media-src 'self' blob: openbot-attachment: openbot-remote-attachment:",
    `connect-src 'self' openbot-attachment: openbot-remote-attachment: https://analytics.openbot.run ws://127.0.0.1:* wss://*.openbot.run${selfHostedSignalSource}${developmentSources}`,
    "object-src 'none'",
    "frame-src 'self' openbot-attachment: openbot-remote-attachment: openbot-visual: openbot-remote-visual: https://*.openbot.run http://127.0.0.1:* http://localhost:*",
    "base-uri 'none'",
  ].join("; ");
}

export function readSelfHostedSignalOrigin(
  authApiUrl: string | undefined,
  signalUrl: string | undefined,
): string | null {
  if (!signalUrl) return null;
  if (!authApiUrl) throw new Error("OPENBOT_REMOTE_SIGNAL_URL needs OPENBOT_AUTH_API_URL.");
  const url = new URL(signalUrl);
  if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") {
    throw new Error("OPENBOT_REMOTE_SIGNAL_URL must be a wss: URL without credentials.");
  }
  return url.origin;
}

function developmentSignalSource(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "ws:" ||
      !isMobileConnectDevelopmentHost(url.hostname) ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return "";
    }
    return ` ${url.origin}`;
  } catch {
    return "";
  }
}
