import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const HOST_RESTART_CAPABILITY = "host-restart-v1";

export const HOST_RESTART_ROUTES = {
  restart: "/v1/admin/host/restart",
} as const;

export const HOST_RESTART_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_RESTART_ROUTES.restart, adminRoute(empty, empty)],
]);
