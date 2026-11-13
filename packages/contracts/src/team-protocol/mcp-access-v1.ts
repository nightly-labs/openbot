// Frozen optional mcp-access-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or an admin reads and
// replaces the access of each MCP server of a host. An entry has `agents`, `everyone` and `roles`.
// `agents` is `null` when each agent of the host gets the server, also an agent that is added later;
// a list names the only agents that get it. `everyone` is the level of each member: `none`, `use` or
// `manage`. `roles` gives a level to the members of a role of `agent-access-v1`, by role id. A member
// gets the highest level of `everyone` and of each role that the member has. Owners, admins, and the
// member who added the server always have `manage`. A server with no entry has `agents: null`,
// `everyone: "use"` and no role level. With `none` the host leaves the server out of the list of
// `mcp-servers-v1` for that member and refuses each route for it with 403. With `use` the member reads
// and tests the server. With `manage` the member also changes it, signs in, signs out, and removes it.
// A member reads only `mine`, the level of that member for each server that the member can see; the
// host leaves out `servers`. A replace names one MCP server and sends its whole entry, with the
// revision that the client read; the host refuses a stale revision with 409. Bounds and meaning do not
// follow IPC changes; widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const MCP_ACCESS_CAPABILITY = "mcp-access-v1";
export const MCP_ACCESS_ROUTES = {
  read: "/v1/mcp-access",
  set: "/v1/mcp-access/set",
} as const;

const level = oneOf("none", "use", "manage");
const levels =
  (maximum: number): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input)) throw new Error("Invalid MCP access levels.");
    const entries = Object.entries(input);
    if (entries.length > maximum) throw new Error("Invalid MCP access levels.");
    return Object.fromEntries(entries.map(([id, value]) => [identifier(id), level(value)]));
  };
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid MCP access request.");
    return decode(input);
  };
const access = exact(
  ["agents", "everyone", "roles"],
  fields({ agents: nullable(list(identifier, 1000)), everyone: level, roles: levels(100) }),
);
const servers: AdminDecoder = (input) => {
  if (!isDynamicRecord(input)) throw new Error("Invalid MCP access servers.");
  const entries = Object.entries(input);
  if (entries.length > 1000) throw new Error("Invalid MCP access servers.");
  return Object.fromEntries(entries.map(([id, value]) => [identifier(id), access(value)]));
};
const snapshot = fields({ revision: count, mine: levels(1000) }, { servers });

export const MCP_ACCESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MCP_ACCESS_ROUTES.read, adminRoute(empty, snapshot)],
  [
    MCP_ACCESS_ROUTES.set,
    adminRoute(
      exact(["revision", "mcpServerId", "access"], fields({ revision: count, mcpServerId: identifier, access })),
      snapshot,
    ),
  ],
]);
