// Frozen optional host-restart-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can ask the host to restart now. Running agent turns stop. The host answers first, then
// closes; its service manager (systemd, or the Docker restart policy) starts it again. Only a host
// in server mode, which runs under such a manager, advertises the capability. A desktop app does
// not, because nothing would start it again. A member cannot use the route; `requireAdmin` on the
// host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const HOST_RESTART_CAPABILITY = "host-restart-v1";

export const HOST_RESTART_ROUTES = {
  restart: "/v1/admin/host/restart",
} as const;

export const HOST_RESTART_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_RESTART_ROUTES.restart, adminRoute(empty, empty)],
]);
