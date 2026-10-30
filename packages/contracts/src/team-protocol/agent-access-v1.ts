// Frozen optional agent-access-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or an admin reads and
// replaces the roles of a server. A role gives its members a level for each agent: `none`, `view`,
// `chat` or `manage`. The "everyone" levels apply to each member; an agent that they do not list is
// `manage`. A role does not give a level for an agent that it does not list. A member gets the highest
// level of "everyone" and of each role that the member has. Owners and admins always have `manage`.
// A member reads only `mine`, the levels that apply to that member; the host leaves out `everyone`
// and `roles`. The host hides a `none` agent from that member as it hides an agent from a client that
// cannot show it, and refuses with 403 a write that the level does not permit. A replace sends the
// revision that the client read; the host refuses a stale revision with 409. Each change sends
// `agent-access-changed` with the new revision. Bounds and meaning do not follow IPC changes; widening
// any of it needs a second capability string.
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
