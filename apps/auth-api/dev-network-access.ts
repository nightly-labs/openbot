const MOBILE_LAN_PATHS = new Set([
  "/v1/mobile-auth/redeem",
  "/v1/mobile-auth/session",
  "/v1/mobile-auth/devices",
  "/v1/me",
  "/v1/me/profile",
  "/v1/me/avatar",
  "/v1/mobile/features",
  "/v2/remote/hosts/",
  "/v2/remote/sessions/",
  "/v2/remote/invites/preview",
  "/v2/remote/invites/accept",
  "/v2/hosting/plans",
  "/v2/hosting/servers/",
]);

export function developmentNetworkRequestAllowed(remoteAddress: string | undefined, requestUrl: string): boolean {
  if (remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") return true;
  const pathname = new URL(requestUrl, "http://openbot.local").pathname;
  if (MOBILE_LAN_PATHS.has(pathname)) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "avatars" && segments[2]) return true;
  // The public preview of one shared agent and its avatar. `mine` lists the user's own templates and
  // stays on loopback.
  if (
    (segments.length === 3 || (segments.length === 4 && segments[3] === "avatar")) &&
    segments[0] === "v1" &&
    segments[1] === "agent-templates" &&
    segments[2] &&
    segments[2] !== "mine"
  )
    return true;
  // The phone buys a hosted server, opens its payment page again, and wakes it.
  if (
    segments.length === 5 &&
    segments[0] === "v2" &&
    segments[1] === "hosting" &&
    segments[2] === "servers" &&
    segments[3] &&
    (segments[4] === "checkout" || segments[4] === "wake")
  )
    return true;
  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "mobile-auth" &&
    segments[2] === "devices" &&
    segments[3]
  )
    return true;
  if (
    segments.length === 5 &&
    segments[0] === "v2" &&
    segments[1] === "remote" &&
    segments[2] === "hosts" &&
    segments[3] &&
    segments[4] === "logo"
  )
    return true;
  // The owner removes a host from the account. `register` is for a desktop host only.
  if (
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "remote" &&
    segments[2] === "hosts" &&
    segments[3] &&
    segments[3] !== "register"
  )
    return true;
  if (
    segments.length === 6 &&
    segments[0] === "v2" &&
    segments[1] === "remote" &&
    segments[2] === "hosts" &&
    segments[3] &&
    segments[4] === "members" &&
    segments[5]
  )
    return true;
  return (
    segments.length === 5 &&
    segments[0] === "v2" &&
    segments[1] === "remote" &&
    segments[2] === "sessions" &&
    Boolean(segments[3]) &&
    (segments[4] === "ticket" || segments[4] === "end")
  );
}
