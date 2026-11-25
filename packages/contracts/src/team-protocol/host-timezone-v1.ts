import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const HOST_TIMEZONE_CAPABILITY = "host-timezone-v1";

export const HOST_TIMEZONE_ROUTES = {
  settings: "/v1/admin/host/timezone",
  update: "/v1/admin/host/timezone/update",
} as const;

const zone = string(128);
const snapshot = fields({ timezone: nullable(zone), systemTimezone: zone });

export const HOST_TIMEZONE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_TIMEZONE_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_TIMEZONE_ROUTES.update, adminRoute(fields({ timezone: nullable(zone) }), snapshot)],
]);
