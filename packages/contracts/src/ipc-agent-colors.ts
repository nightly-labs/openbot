import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

const AGENT_COLORS_LIMIT = 1000;

export interface AgentColorEntry {
  agentId: string;
  color: AvatarColor;
}

export interface AgentColors {
  agents: AgentColorEntry[];
}

export interface SetAgentColorInput {
  agentId: string;
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
