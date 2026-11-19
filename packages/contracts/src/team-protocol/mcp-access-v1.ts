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
