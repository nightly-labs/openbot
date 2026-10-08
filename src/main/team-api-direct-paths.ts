import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";

/**
 * The Team API paths that stay on WebRTC when a member reaches the host directly over Tailscale: the
 * remote screen and the browser live view. Their streams use the WebRTC session that asked for them.
 * The host's direct listener refuses these paths, and the client sends them over WebRTC.
 */
export function isWebRtcOnlyTeamPath(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return (
    pathname === TEAM_API_ROUTES.remoteScreen.prefix ||
    pathname.startsWith(`${TEAM_API_ROUTES.remoteScreen.prefix}/`) ||
    pathname === TEAM_API_ROUTES.browser.viewSessions ||
    pathname.startsWith(`${TEAM_API_ROUTES.browser.viewSessions}/`)
  );
}
