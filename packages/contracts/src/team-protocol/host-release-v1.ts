// Optional host-release-v1 contract. All signed-in server members can read release status and check the
// official stable feed for the host's platform and architecture. This never downloads application
// files, changes update preferences, or restarts the host. It is available even when remote
// installation is disabled or a host administrator controls installation. host-update-v1 is unchanged.
import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const HOST_RELEASE_CAPABILITY = "host-release-v1";
export const HOST_RELEASE_ROUTES = {
  status: "/v1/host/release/status",
  check: "/v1/host/release/check",
} as const;

const snapshot = fields({
  currentVersion: string(64),
  latestVersion: nullable(string(64)),
  phase: oneOf("idle", "checking", "available", "up-to-date", "error", "unavailable"),
  method: oneOf("self-update", "host-manager", "hosted", "system", "container", "manual", "unavailable"),
});

export const HOST_RELEASE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_RELEASE_ROUTES.status, adminRoute(empty, snapshot)],
  [HOST_RELEASE_ROUTES.check, adminRoute(empty, snapshot)],
]);
