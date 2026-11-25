import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const AGENT_ACCESS_CAPABILITY = "agent-access-v1";
export const AGENT_ACCESS_ROUTES = {
  read: "/v1/agent-access",
  set: "/v1/agent-access/set",
} as const;

const level = oneOf("none", "view", "chat", "manage");
const levels: AdminDecoder = (input) => {
  if (!isDynamicRecord(input)) throw new Error("Invalid agent access levels.");
  const entries = Object.entries(input);
  if (entries.length > 1000) throw new Error("Invalid agent access levels.");
  return Object.fromEntries(entries.map(([agentId, value]) => [identifier(agentId), level(value)]));
};
const role = fields({
  id: identifier,
  name: string(100),
  agents: levels,
  memberIds: list(identifier, 1000),
});
const roles = list(role, 100);
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent access request.");
    return decode(input);
  };
const snapshot = fields({ revision: count, mine: levels }, { everyone: levels, roles });

export const AGENT_ACCESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_ACCESS_ROUTES.read, adminRoute(empty, snapshot)],
  [
    AGENT_ACCESS_ROUTES.set,
    adminRoute(
      exact(["revision", "everyone", "roles"], fields({ revision: count, everyone: levels, roles })),
      snapshot,
    ),
  ],
]);

export type AgentAccessEvent = { type: "agent-access-changed"; revision: number };
export function agentAccessEvent(input: unknown): AgentAccessEvent | null {
  if (!isDynamicRecord(input) || input.type !== "agent-access-changed") return null;
  const revision = count(input.revision);
  if (typeof revision !== "number") throw new Error("Invalid agent access event.");
  return { type: "agent-access-changed", revision };
}
