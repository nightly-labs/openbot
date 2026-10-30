import { isIdentifier } from "./ipc-bounded-values";
import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "./ipc-team-host";
import { isDynamicRecord } from "./runtime-values";

/**
 * The notification level that the signed-in user chose for one agent. It replaces the level of the
 * server for the events of that agent, on each device of the user. The host keeps it for each
 * member, so the other members of the server keep their own choice.
 */
export interface AgentNotificationLevelEntry {
  agentId: string;
  level: ServerNotificationLevel;
}

/** The most agents with a level of their own, as `agent-notification-levels-v1` permits. */
export const AGENT_NOTIFICATION_LEVEL_LIMIT = 1000;

/** The agents that have a level of their own. An agent that is not in the list uses the server level. */
export interface AgentNotificationLevelsSnapshot {
  agents: AgentNotificationLevelEntry[];
}

export interface SetAgentNotificationLevelInput {
  agentId: string;
  /** `null` removes the level of the agent, so the server level applies again. */
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

/** The levels of a snapshot by agent. */
export function agentNotificationLevelMap(
  snapshot: AgentNotificationLevelsSnapshot,
): ReadonlyMap<string, ServerNotificationLevel> {
  return new Map(snapshot.agents.map(({ agentId, level }) => [agentId, level]));
}
