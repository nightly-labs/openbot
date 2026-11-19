import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const LOCAL_SERVERS_CAPABILITY = "local-servers-v1";

export const LOCAL_SERVERS_ROUTES = {
  list: "/v1/admin/host/local-servers",
  create: "/v1/admin/host/local-servers/create",
  delete: "/v1/admin/host/local-servers/delete",
} as const;

const name = string(120);
const server = fields({ serverId: identifier, name, published: boolean });
const snapshot = fields({ servers: list(server, 64), limit: count });

export const LOCAL_SERVERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [LOCAL_SERVERS_ROUTES.list, adminRoute(empty, snapshot)],
  [LOCAL_SERVERS_ROUTES.create, adminRoute(fields({ name }), server)],
  [LOCAL_SERVERS_ROUTES.delete, adminRoute(fields({ serverId: identifier }), empty)],
]);
