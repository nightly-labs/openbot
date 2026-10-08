import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";

/**
 * The Team API paths that stay on WebRTC when a member reaches the host directly over Tailscale: the
 * remote screen and the browser live view. Their streams use the WebRTC session that asked for them.
 * The host's direct listener refuses these paths, and the client sends them over WebRTC. The remote
 * screen readiness is the exception: it only reports whether the host can share its screen.
 */
export function isWebRtcOnlyTeamPath(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === TEAM_API_ROUTES.remoteScreen.capabilities) return false;
  return (
    pathname === TEAM_API_ROUTES.remoteScreen.prefix ||
    pathname.startsWith(`${TEAM_API_ROUTES.remoteScreen.prefix}/`) ||
    pathname === TEAM_API_ROUTES.browser.viewSessions ||
    pathname.startsWith(`${TEAM_API_ROUTES.browser.viewSessions}/`)
  );
}
