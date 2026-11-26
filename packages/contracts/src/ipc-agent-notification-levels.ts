import { isIdentifier } from "./ipc-bounded-values";
import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "./ipc-team-host";
import { isDynamicRecord } from "./runtime-values";

export interface AgentNotificationLevelEntry {
  agentId: string;
  level: ServerNotificationLevel;
}

export const AGENT_NOTIFICATION_LEVEL_LIMIT = 1000;

export interface AgentNotificationLevelsSnapshot {
  server: ServerNotificationLevel | null;
  agents: AgentNotificationLevelEntry[];
}

export const EMPTY_AGENT_NOTIFICATION_LEVELS: AgentNotificationLevelsSnapshot = { server: null, agents: [] };

export interface SetOwnServerNotificationLevelInput {
  level: ServerNotificationLevel | null;
}

export interface SetAgentNotificationLevelInput {
  agentId: string;
  level: ServerNotificationLevel | null;
}

export function isServerNotificationLevel(value: unknown): value is ServerNotificationLevel {
  return typeof value === "string" && SERVER_NOTIFICATION_LEVELS.some((level) => level === value);
}

function isAgentNotificationLevelEntry(value: unknown): value is AgentNotificationLevelEntry {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agentId" || key === "level") &&
    isIdentifier(value.agentId) &&
    isServerNotificationLevel(value.level)
  );
}

export function isAgentNotificationLevelsSnapshot(value: unknown): value is AgentNotificationLevelsSnapshot {
  return (
    isDynamicRecord(value) &&
    (value.server === null || isServerNotificationLevel(value.server)) &&
    Array.isArray(value.agents) &&
    value.agents.length <= AGENT_NOTIFICATION_LEVEL_LIMIT &&
    value.agents.every(isAgentNotificationLevelEntry) &&
    new Set(value.agents.map((agent) => agent.agentId)).size === value.agents.length
  );
}

export function parseSetAgentNotificationLevelInput(value: unknown): SetAgentNotificationLevelInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "agentId" && key !== "level") ||
    !isIdentifier(value.agentId) ||
    (value.level !== null && !isServerNotificationLevel(value.level))
  )
    throw new Error("Invalid agent notification level request.");
  return { agentId: value.agentId, level: value.level };
}

export function parseSetOwnServerNotificationLevelInput(value: unknown): SetOwnServerNotificationLevelInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "level") ||
    (value.level !== null && !isServerNotificationLevel(value.level))
  )
    throw new Error("Invalid server notification level request.");
  return { level: value.level };
}

export function agentNotificationLevelMap(
  snapshot: AgentNotificationLevelsSnapshot,
): ReadonlyMap<string, ServerNotificationLevel> {
  return new Map(snapshot.agents.map(({ agentId, level }) => [agentId, level]));
}
