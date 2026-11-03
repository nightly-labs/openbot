import { isDynamicRecord } from "../runtime-values";
// Additive connector-access-v1: owner/admin-only policy, no credentials on this wire.
import {
  type AdminDecoder,
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
export const CONNECTOR_ACCESS_CAPABILITY = "connector-access-v1";
export const CONNECTOR_ACCESS_ROUTES = { read: "/v1/connector-access", set: "/v1/connector-access/set" } as const;
const ids = list(identifier, 1000);
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid connector access request.");
    return decode(input);
  };
const rule = exact(
  ["mcpServerId", "agentIds", "everyoneUse", "roleIds"],
  fields({ mcpServerId: identifier, agentIds: ids, everyoneUse: boolean, roleIds: ids }),
);
const binding = fields({
  mcpServerId: identifier,
  agentIds: ids,
  everyoneUse: boolean,
  roleIds: ids,
  audienceAgentIds: ids,
});
const change: AdminDecoder = exact(["revision", "rules"], fields({ revision: count, rules: list(rule, 1000) }));
const snapshot = fields({
  revision: count,
  closed: boolean,
  rules: list(binding, 1000),
  connectors: list(fields({ id: identifier, name: string(1024) }), 1000),
});
export const CONNECTOR_ACCESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONNECTOR_ACCESS_ROUTES.read, adminRoute(empty, snapshot)],
  [CONNECTOR_ACCESS_ROUTES.set, adminRoute(change, snapshot)],
]);
