// Frozen optional memory-review-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set how many completed turns of one conversation pass between two background
// memory reviews of that server's agents. `0` turns the review off. The snapshot gives the value and
// the values the host permits, so a client offers only those. The host refuses any other value. A
// member cannot use either route; `requireAdmin` on the host is the only gate. Widening any of it
// needs a second capability string.
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
