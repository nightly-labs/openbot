import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export type AgentMemoryOrigin = "automatic" | "manual";

export interface MemoryEntry {
  id: string;
  text: string;
  origin: AgentMemoryOrigin;
  sourceTurnId: string | null;
  createdAt: string;
  updatedAt: string;
  site?: string;
}

export const MEMORY_SITE_MAX_LENGTH = 253;

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
    isString(value.updatedAt) &&
    (value.site === undefined ||
      (isString(value.site) && value.site.length > 0 && value.site.length <= MEMORY_SITE_MAX_LENGTH))
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

export const AGENT_MEMORY_LIMITS = [INPUT_LIMITS.agentMemories, 128, 256, 512] as const;
export type AgentMemoryLimit = (typeof AGENT_MEMORY_LIMITS)[number];
export const DEFAULT_AGENT_MEMORY_LIMIT: AgentMemoryLimit = 256;

export function isAgentMemoryLimit(value: unknown): value is AgentMemoryLimit {
  return isOneOf(AGENT_MEMORY_LIMITS, value);
}

export interface AgentMemoryLimitPreference {
  limit: AgentMemoryLimit;
}

export const MEMORY_REVIEW_INTERVALS = [0, 10, 20, 40] as const;
export type MemoryReviewInterval = (typeof MEMORY_REVIEW_INTERVALS)[number];
export const DEFAULT_MEMORY_REVIEW_INTERVAL: MemoryReviewInterval = 20;

export function isMemoryReviewInterval(value: unknown): value is MemoryReviewInterval {
  return isOneOf(MEMORY_REVIEW_INTERVALS, value);
}

export interface MemoryReviewPreference {
  interval: MemoryReviewInterval;
}

export interface HostMemoryReview {
  interval: number;
  choices: number[];
}

export function hostMemoryReview({ interval }: MemoryReviewPreference): HostMemoryReview {
  return { interval, choices: [...MEMORY_REVIEW_INTERVALS] };
}

export function decodeHostMemoryReview(value: unknown): HostMemoryReview {
  const count = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!isDynamicRecord(value) || !count(value.interval) || !Array.isArray(value.choices) || !value.choices.every(count))
    throw new Error("Invalid memory review setting.");
  return { interval: value.interval, choices: [...value.choices] };
}

export interface HostAgentMemoryLimit {
  limit: number;
  choices: number[];
}

export function hostAgentMemoryLimit({ limit }: AgentMemoryLimitPreference): HostAgentMemoryLimit {
  return { limit, choices: [...AGENT_MEMORY_LIMITS] };
}

export function decodeHostAgentMemoryLimit(value: unknown): HostAgentMemoryLimit {
  const count = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0;
  if (!isDynamicRecord(value) || !count(value.limit) || !Array.isArray(value.choices) || !value.choices.every(count))
    throw new Error("Invalid agent memory limit.");
  return { limit: value.limit, choices: [...value.choices] };
}

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

export interface BrowsingMemoryPreference {
  enabled: boolean;
}

export const DEFAULT_BROWSING_MEMORY_PREFERENCE: BrowsingMemoryPreference = { enabled: false };

export interface HostBrowsingMemory {
  enabled: boolean;
}

export function hostBrowsingMemory({ enabled }: BrowsingMemoryPreference): HostBrowsingMemory {
  return { enabled };
}

export function decodeHostBrowsingMemory(value: unknown): HostBrowsingMemory {
  if (!isDynamicRecord(value) || typeof value.enabled !== "boolean")
    throw new Error("Invalid browsing memory setting.");
  return { enabled: value.enabled };
}
