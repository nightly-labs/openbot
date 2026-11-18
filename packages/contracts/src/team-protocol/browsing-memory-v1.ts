// Frozen optional browsing-memory-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set "Learn from my browsing" for that server's agents. When it is on, the host
// records the pages that load and the controls that a person clicks in an agent's tab while that
// person holds the tab (takeover or Take control), and the agent's background memory review reads
// them to keep site memories. It never records typed text. Turning it off deletes what it recorded.
// The snapshot gives the value only. A member cannot use either route; `requireAdmin` on the host is
// the only gate. A protocol 9 capability only. Widening any of it needs a second capability string.
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
