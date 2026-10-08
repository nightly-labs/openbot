import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";

const TAILSCALE_SETUP_PATHS = new Set<string>(Object.values(HOST_TAILSCALE_ROUTES));

/**
 * The Team API paths that stay on WebRTC when a member reaches the host directly over Tailscale: the
 * remote screen and the browser live view, whose streams use the WebRTC session that asked for them,
 * and the owner's Tailscale setup, which can take the direct path down while it answers. The host's
 * direct listener refuses these paths, and the client sends them over WebRTC. The remote screen
 * readiness is the exception: it only reports whether the host can share its screen.
 */
export function isWebRtcOnlyTeamPath(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === TEAM_API_ROUTES.remoteScreen.capabilities) return false;
  return (
    TAILSCALE_SETUP_PATHS.has(pathname) ||
    pathname === TEAM_API_ROUTES.remoteScreen.prefix ||
    pathname.startsWith(`${TEAM_API_ROUTES.remoteScreen.prefix}/`) ||
    pathname === TEAM_API_ROUTES.browser.viewSessions ||
    pathname.startsWith(`${TEAM_API_ROUTES.browser.viewSessions}/`)
  );
}
