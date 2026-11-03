import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/** The `agent-colors-v1` list bound. A server can keep more agents than one IPC agent list. */
const AGENT_COLORS_LIMIT = 1000;

/** The exact colour of one agent on a server. An agent that is not in the list draws its `avatarHue`. */
export interface AgentColorEntry {
  agentId: string;
  color: AvatarColor;
}

/** The agents of a server that have an exact colour, in the `agent-colors-v1` wire shape. */
export interface AgentColors {
  agents: AgentColorEntry[];
}

export interface SetAgentColorInput {
  agentId: string;
  /** `null` removes the colour. The agent then draws its `avatarHue`. */
  color: AvatarColor | null;
}

export function isAgentColorEntry(value: unknown): value is AgentColorEntry {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agentId" || key === "color") &&
    isIdentifier(value.agentId) &&
    isAvatarColor(value.color)
  );
}

export function isAgentColors(value: unknown): value is AgentColors {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= AGENT_COLORS_LIMIT &&
    value.agents.every(isAgentColorEntry) &&
    new Set(value.agents.map((agent) => agent.agentId)).size === value.agents.length
  );
}

export function parseSetAgentColorInput(value: unknown): SetAgentColorInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "color") ||
    !isIdentifier(value.agentId) ||
    (value.color !== null && !isAvatarColor(value.color))
  )
    throw new Error("Invalid agent color request.");
  return { agentId: value.agentId, color: value.color };
}
