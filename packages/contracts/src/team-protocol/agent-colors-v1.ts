import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
} from "./admin-wire";

export const AGENT_COLORS_CAPABILITY = "agent-colors-v1";
export const AGENT_COLORS_ROUTES = {
  read: "/v1/agent-colors",
  set: "/v1/agent-colors/set",
} as const;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const isColor = (input: unknown): input is `#${string}` => typeof input === "string" && COLOR_PATTERN.test(input);
const color: AdminDecoder = (input) => {
  if (!isColor(input)) throw new Error("Invalid agent color.");
  return input;
};
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent color request.");
    return decode(input);
  };
const agents = list(fields({ agentId: identifier, color }), 1000);
const snapshot = fields({ agents });

export const AGENT_COLORS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_COLORS_ROUTES.read, adminRoute(empty, snapshot)],
  [
    AGENT_COLORS_ROUTES.set,
    adminRoute(exact(["agentId", "color"], fields({ agentId: identifier, color: nullable(color) })), snapshot),
  ],
]);

export interface AgentColorsSnapshot {
  agents: { agentId: string; color: `#${string}` }[];
}

export type AgentColorsEvent = { type: "agent-colors-changed" } & AgentColorsSnapshot;

export function decodeAgentColorsSnapshot(input: unknown): AgentColorsSnapshot {
  const decoded = snapshot(input);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.agents)) throw new Error("Invalid agent colors.");
  return {
    agents: decoded.agents.map((entry) => {
      if (!isDynamicRecord(entry) || typeof entry.agentId !== "string" || !isColor(entry.color))
        throw new Error("Invalid agent colors.");
      return { agentId: entry.agentId, color: entry.color };
    }),
  };
}

export function agentColorsEvent(input: unknown): AgentColorsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "agent-colors-changed") return null;
  return { type: "agent-colors-changed", ...decodeAgentColorsSnapshot({ agents: input.agents }) };
}
