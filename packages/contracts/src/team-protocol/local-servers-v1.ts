// Frozen optional local-servers-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: the owner of the server that
// the OpenBot desktop app runs can list the other servers that the app runs on the same computer, and
// create one with a name, or delete one. Each one is a separate server with its own agents, chats and files. When the
// desktop app is signed in, it registers each one for the owner's account, so the owner's devices list
// it as any other server; `published` is false while it is not registered. `limit` is how many the
// computer can run in addition to its own server, and the host refuses a create past it. The host also
// refuses a name that its own server name check refuses. A delete moves the server's data to the
// Trash of that computer and removes the server from the account; it answers an empty record. An admin or a member gets 403; `requireOwner`
// on the host is the only gate. Widening any of it needs a second capability string.
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

/** The same bound as the account service's host name. */
const name = string(120);
const server = fields({ serverId: identifier, name, published: boolean });
const snapshot = fields({ servers: list(server, 64), limit: count });

export const LOCAL_SERVERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [LOCAL_SERVERS_ROUTES.list, adminRoute(empty, snapshot)],
  [LOCAL_SERVERS_ROUTES.create, adminRoute(fields({ name }), server)],
  [LOCAL_SERVERS_ROUTES.delete, adminRoute(fields({ serverId: identifier }), empty)],
]);
