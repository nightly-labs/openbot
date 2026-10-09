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

/**
 * The choices for how many memories one agent can hold on this computer. The first is the default,
 * which was the only cap before the setting existed. A lower cap never deletes memories: an agent
 * over it keeps them and only cannot add another.
 */
// A full list must fit the released 2 MiB WebRTC frame, including JSON escaping.
export const AGENT_MEMORY_LIMITS = [INPUT_LIMITS.agentMemories, 128, 256, 512] as const;
export type AgentMemoryLimit = (typeof AGENT_MEMORY_LIMITS)[number];
export const DEFAULT_AGENT_MEMORY_LIMIT: AgentMemoryLimit = INPUT_LIMITS.agentMemories;

export function isAgentMemoryLimit(value: unknown): value is AgentMemoryLimit {
  return isOneOf(AGENT_MEMORY_LIMITS, value);
}

/** The app setting, as it is stored and as it crosses IPC. */
export interface AgentMemoryLimitPreference {
  limit: AgentMemoryLimit;
}
