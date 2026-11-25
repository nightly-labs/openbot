import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const BROWSING_MEMORY_CAPABILITY = "browsing-memory-v1";

export const BROWSING_MEMORY_ROUTES = {
  settings: "/v1/admin/host/browsing-memory",
  update: "/v1/admin/host/browsing-memory/update",
} as const;

const snapshot = fields({ enabled: boolean });

export const BROWSING_MEMORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSING_MEMORY_ROUTES.settings, adminRoute(empty, snapshot)],
  [BROWSING_MEMORY_ROUTES.update, adminRoute(fields({ enabled: boolean }), snapshot)],
]);
