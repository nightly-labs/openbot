// Frozen optional shared-tables-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list the tables the host's agents keep in their shared database, with the row count,
// and delete one. It never carries a row. A member cannot use either route; `requireAdmin` on the
// host is the only gate. Widening any of it needs a second capability string.
import {
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const SHARED_TABLES_CAPABILITY = "shared-tables-v1";

export const SHARED_TABLES_ROUTES = {
  list: "/v1/admin/shared-tables/list",
  delete: "/v1/admin/shared-tables/delete",
} as const;

const name = string(256);
const table = fields({ name, ownerAgentId: nullable(identifier), rowCount: nullable(count) });

export const SHARED_TABLES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SHARED_TABLES_ROUTES.list, adminRoute(empty, list(table, 10_000))],
  [SHARED_TABLES_ROUTES.delete, adminRoute(fields({ name }), empty)],
]);
