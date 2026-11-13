import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord } from "./runtime-values";

/**
 * An agent the user hid. It keeps its thread, files, memories, settings and sidebar section, and it
 * keeps working: its routines run and it gets messages. A server without `agent-hidden-work` stops
 * it until the user restores it. The state belongs to the server, so every device that shows the
 * server shows the same hidden agents.
 */
export interface HiddenAgent {
  agentId: string;
  /** ISO 8601 time of the hide. */
  hiddenAt: string;
}

export interface HiddenAgentsSnapshot {
  agents: HiddenAgent[];
}

export interface SetAgentHiddenInput {
  agentId: string;
  hidden: boolean;
}

export function isHiddenAt(value: unknown): value is string {
  return isBoundedString(value, 64) && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isHiddenAgent(value: unknown): value is HiddenAgent {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agentId" || key === "hiddenAt") &&
    isIdentifier(value.agentId) &&
    isHiddenAt(value.hiddenAt)
  );
}

export function isHiddenAgentsSnapshot(value: unknown): value is HiddenAgentsSnapshot {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= INPUT_LIMITS.agents &&
    value.agents.every(isHiddenAgent) &&
    new Set(value.agents.map((agent) => agent.agentId)).size === value.agents.length
  );
}

export function parseSetAgentHiddenInput(value: unknown): SetAgentHiddenInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "hidden") ||
    !isIdentifier(value.agentId) ||
    !isBoolean(value.hidden)
  )
    throw new Error("Invalid hidden agent request.");
  return { agentId: value.agentId, hidden: value.hidden };
}
