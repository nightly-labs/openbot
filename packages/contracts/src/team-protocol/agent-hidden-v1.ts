// Frozen optional agent-hidden-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member reads
// the agents that the host owner or an admin hid. Only an owner or an admin hides or restores one; the
// host refuses a member with 403. A hidden agent stays in
// `/v1/agents` with all of its data. A host that has only this capability does not run its routines
// and refuses new messages to it until it is restored. A host that also has `agent-hidden-work`
// keeps the agent at work: the hide then takes the agent out of the list and changes no other thing.
// The routes and the shapes here are the same on both. Each change sends `hidden-agents-changed`
// with the whole list. Bounds and meaning do not follow IPC changes; widening any of it needs a
// second capability string.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
} from "./admin-wire";

export const AGENT_HIDDEN_CAPABILITY = "agent-hidden-v1";
export const AGENT_HIDDEN_ROUTES = {
  read: "/v1/hidden-agents",
  set: "/v1/hidden-agents/set",
} as const;

const hiddenAt: AdminDecoder = (input) => {
  if (typeof input !== "string" || input.length === 0 || input.length > 64 || Number.isNaN(Date.parse(input)))
    throw new Error("Invalid hidden agent time.");
  return input;
};
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid hidden agent request.");
    return decode(input);
  };
const agents = list(fields({ agentId: identifier, hiddenAt }), 1000);
const snapshot = fields({ agents });

export const AGENT_HIDDEN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_HIDDEN_ROUTES.read, adminRoute(empty, snapshot)],
  [
    AGENT_HIDDEN_ROUTES.set,
    adminRoute(exact(["agentId", "hidden"], fields({ agentId: identifier, hidden: boolean })), snapshot),
  ],
]);

export type AgentHiddenEvent = {
  type: "hidden-agents-changed";
  agents: { agentId: string; hiddenAt: string }[];
};
export function agentHiddenEvent(input: unknown): AgentHiddenEvent | null {
  if (!isDynamicRecord(input) || input.type !== "hidden-agents-changed") return null;
  const decoded = agents(input.agents);
  if (!Array.isArray(decoded)) throw new Error("Invalid hidden agents event.");
  return {
    type: "hidden-agents-changed",
    agents: decoded.map((entry) => {
      if (!isDynamicRecord(entry) || typeof entry.agentId !== "string" || typeof entry.hiddenAt !== "string")
        throw new Error("Invalid hidden agents event.");
      return { agentId: entry.agentId, hiddenAt: entry.hiddenAt };
    }),
  };
}
