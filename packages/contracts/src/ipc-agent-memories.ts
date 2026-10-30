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
 * The choices for how many memories one agent can hold on this computer. The first was the only cap
 * before the setting existed. A lower cap never deletes memories: an agent over it keeps them and
 * only cannot add another.
 */
export const AGENT_MEMORY_LIMITS = [INPUT_LIMITS.agentMemories, 128, 256, 512] as const;
export type AgentMemoryLimit = (typeof AGENT_MEMORY_LIMITS)[number];
/**
 * Background reviews add memories without a request, so the default leaves room for many small ones.
 * Only essential memories enter each prompt, within their own budget; the rest cost a search.
 */
export const DEFAULT_AGENT_MEMORY_LIMIT: AgentMemoryLimit = 256;

export function isAgentMemoryLimit(value: unknown): value is AgentMemoryLimit {
  return isOneOf(AGENT_MEMORY_LIMITS, value);
}

/** The app setting, as it is stored and as it crosses IPC. */
export interface AgentMemoryLimitPreference {
  limit: AgentMemoryLimit;
}

/**
 * The choices for how many completed turns of one conversation pass between two background memory
 * reviews on this computer. `0` turns the reviews off, also after a pause, a cleared chat and a
 * closed side thread. The default is 20.
 */
export const MEMORY_REVIEW_INTERVALS = [0, 10, 20, 40] as const;
export type MemoryReviewInterval = (typeof MEMORY_REVIEW_INTERVALS)[number];
export const DEFAULT_MEMORY_REVIEW_INTERVAL: MemoryReviewInterval = 20;

export function isMemoryReviewInterval(value: unknown): value is MemoryReviewInterval {
  return isOneOf(MEMORY_REVIEW_INTERVALS, value);
}

/** The app setting, as it is stored. */
export interface MemoryReviewPreference {
  interval: MemoryReviewInterval;
}

/**
 * The review cadence of one server's agents (`memory-review-v1`) and the values that host permits.
 * A newer host can permit other values, so they are numbers here, not `MemoryReviewInterval`.
 */
export interface HostMemoryReview {
  interval: number;
  choices: number[];
}

export function hostMemoryReview({ interval }: MemoryReviewPreference): HostMemoryReview {
  return { interval, choices: [...MEMORY_REVIEW_INTERVALS] };
}

/** On the wire the route codec has already checked the fields; this fails closed on anything else. */
export function decodeHostMemoryReview(value: unknown): HostMemoryReview {
  const count = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!isDynamicRecord(value) || !count(value.interval) || !Array.isArray(value.choices) || !value.choices.every(count))
    throw new Error("Invalid memory review setting.");
  return { interval: value.interval, choices: [...value.choices] };
}

/**
 * The limit of one server's agents (`agent-memory-limit-v1`) and the values that host permits. A
 * newer host can permit other values, so they are numbers here, not `AgentMemoryLimit`.
 */
export interface HostAgentMemoryLimit {
  limit: number;
  choices: number[];
}

export function hostAgentMemoryLimit({ limit }: AgentMemoryLimitPreference): HostAgentMemoryLimit {
  return { limit, choices: [...AGENT_MEMORY_LIMITS] };
}

/** On the wire the route codec has already checked the fields; this fails closed on anything else. */
export function decodeHostAgentMemoryLimit(value: unknown): HostAgentMemoryLimit {
  const count = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0;
  if (!isDynamicRecord(value) || !count(value.limit) || !Array.isArray(value.choices) || !value.choices.every(count))
    throw new Error("Invalid agent memory limit.");
  return { limit: value.limit, choices: [...value.choices] };
}

/** Selection metadata stays separate from the released memory shape. */
export interface AgentMemorySelection {
  memoryId: string;
  inclusion: "essential" | "searchable";
  userControlled: boolean;
  revision: number;
}

export interface AgentMemorySelectionChange {
  memoryId: string;
  inclusion: "essential" | "searchable" | "automatic";
  expectedRevision: number;
}

export interface AgentMemorySelectionState {
  selections: AgentMemorySelection[];
  usedBytes: number;
  budgetBytes: number;
}

export interface SetAgentMemoryInclusionInput {
  agentId: string;
  changes: AgentMemorySelectionChange[];
}

export function isAgentMemorySelection(value: unknown): value is AgentMemorySelection {
  return (
    isDynamicRecord(value) &&
    isString(value.memoryId) &&
    value.memoryId.length > 0 &&
    value.memoryId.length <= INPUT_LIMITS.identifier &&
    isOneOf(["essential", "searchable"] as const, value.inclusion) &&
    typeof value.userControlled === "boolean" &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
  );
}

export function isAgentMemorySelectionState(value: unknown): value is AgentMemorySelectionState {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.selections) &&
    value.selections.every(isAgentMemorySelection) &&
    new Set(value.selections.map((entry) => entry.memoryId)).size === value.selections.length &&
    typeof value.usedBytes === "number" &&
    Number.isSafeInteger(value.usedBytes) &&
    value.usedBytes >= 0 &&
    value.budgetBytes === 8192 &&
    value.usedBytes <= value.budgetBytes
  );
}
