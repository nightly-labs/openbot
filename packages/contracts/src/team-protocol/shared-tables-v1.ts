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
