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
