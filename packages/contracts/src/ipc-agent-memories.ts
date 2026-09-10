import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export type AgentMemoryOrigin = "automatic" | "manual";

/**
 * The part of a memory that does not name its owner. One store and one panel serve both an agent
 * and a channel, and this is the shape they share; `AgentMemory` and `ChannelMemory` only add the
 * owner id. Neither of those two names changes shape.
 */
export interface MemoryEntry {
  id: string;
  text: string;
  origin: AgentMemoryOrigin;
  sourceTurnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemory extends MemoryEntry {
  agentId: string;
}

export function isMemoryEntry(value: unknown): value is MemoryEntry {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    value.id.length > 0 &&
    value.id.length <= INPUT_LIMITS.identifier &&
    isString(value.text) &&
    value.text.length > 0 &&
    value.text.length <= INPUT_LIMITS.agentMemoryText &&
    isOneOf(["automatic", "manual"] as const, value.origin) &&
    (value.sourceTurnId === null ||
      (isString(value.sourceTurnId) &&
        value.sourceTurnId.length > 0 &&
        value.sourceTurnId.length <= INPUT_LIMITS.identifier)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isAgentMemory(value: unknown): value is AgentMemory {
  return (
    isDynamicRecord(value) &&
    isMemoryEntry(value) &&
    isString(value.agentId) &&
    value.agentId.length > 0 &&
    value.agentId.length <= INPUT_LIMITS.identifier
  );
}

export interface CreateAgentMemoryInput {
  agentId: string;
  text: string;
}

export interface UpdateAgentMemoryInput {
  agentId: string;
  memoryId: string;
  text: string;
}

export interface DeleteAgentMemoryInput {
  agentId: string;
  memoryId: string;
}
