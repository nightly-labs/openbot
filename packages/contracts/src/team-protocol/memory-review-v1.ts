import { adminRoute, count, empty, fields, list, type OptionalRouteCodec } from "./admin-wire";

export const MEMORY_REVIEW_CAPABILITY = "memory-review-v1";

export const MEMORY_REVIEW_ROUTES = {
  settings: "/v1/admin/host/memory-review",
  update: "/v1/admin/host/memory-review/update",
} as const;

const snapshot = fields({ interval: count, choices: list(count, 16) });

export const MEMORY_REVIEW_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MEMORY_REVIEW_ROUTES.settings, adminRoute(empty, snapshot)],
  [MEMORY_REVIEW_ROUTES.update, adminRoute(fields({ interval: count }), snapshot)],
]);
