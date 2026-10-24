import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord } from "./runtime-values";

/**
 * An agent the user archived. It keeps its thread, files, memories, settings and sidebar section.
 * Its routines do not run, it receives no new messages, and it is excluded from teammate
 * delegation until the user unarchives it. The state belongs to the server, so every device that
 * shows the server shows the same archived agents.
 *
 * Archive differs from hide in intent: hiding is a quick sidebar cleanup, archiving is long-term
 * storage of an agent the user may return to later. Both preserve all data.
 */
export interface ArchivedAgent {
  agentId: string;
  /** ISO 8601 time of the archive. */
  archivedAt: string;
}

export interface ArchivedAgentsSnapshot {
  agents: ArchivedAgent[];
}

export interface SetAgentArchivedInput {
  agentId: string;
  archived: boolean;
}

export function isArchivedAt(value: unknown): value is string {
  return isBoundedString(value, 64) && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function isArchivedAgent(value: unknown): value is ArchivedAgent {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agentId" || key === "archivedAt") &&
    isIdentifier(value.agentId) &&
    isArchivedAt(value.archivedAt)
  );
}

export function isArchivedAgentsSnapshot(value: unknown): value is ArchivedAgentsSnapshot {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= INPUT_LIMITS.agents &&
    value.agents.every(isArchivedAgent) &&
    new Set(value.agents.map((agent) => agent.agentId)).size === value.agents.length
  );
}

export function parseSetAgentArchivedInput(value: unknown): SetAgentArchivedInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "archived") ||
    !isIdentifier(value.agentId) ||
    !isBoolean(value.archived)
  )
    throw new Error("Invalid archived agent request.");
  return { agentId: value.agentId, archived: value.archived };
}
