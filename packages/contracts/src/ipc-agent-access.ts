import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

/** What a member can do with one agent. Each level includes the levels before it. */
export const AGENT_ACCESS_LEVELS = ["none", "view", "chat", "manage"] as const;
export type AgentAccessLevel = (typeof AGENT_ACCESS_LEVELS)[number];

/** Levels by agent id. */
export type AgentAccessLevels = Record<string, AgentAccessLevel>;

/** A role of a server: a name, a level for each agent that it lists, and its members. */
export interface AgentAccessRole {
  id: string;
  name: string;
  agents: AgentAccessLevels;
  memberIds: string[];
}

/**
 * The roles of one server (`agent-access-v1`). `mine` holds the levels that apply to the caller. An
 * owner or admin also gets `everyone` and `roles`; a member does not.
 */
export interface AgentAccessSnapshot {
  revision: number;
  mine: AgentAccessLevels;
  everyone?: AgentAccessLevels;
  roles?: AgentAccessRole[];
}

/** A full replace. `revision` is the one the client read; the host refuses a stale one. */
export interface AgentAccessChange {
  revision: number;
  everyone: AgentAccessLevels;
  roles: AgentAccessRole[];
}

// The same bounds as agent-access-v1.
export const AGENT_ACCESS_ROLE_LIMIT = 100;
export const AGENT_ACCESS_ROLE_NAME_LIMIT = 100;
const AGENT_LIMIT = 1000;
const MEMBER_LIMIT = 1000;

export function agentAccessRank(level: AgentAccessLevel): number {
  return AGENT_ACCESS_LEVELS.indexOf(level);
}

function isRevision(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isLevels(value: unknown): value is AgentAccessLevels {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= AGENT_LIMIT &&
    entries.every(([agentId, level]) => isIdentifier(agentId) && isOneOf(AGENT_ACCESS_LEVELS, level))
  );
}

function isRole(value: unknown): value is AgentAccessRole {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, AGENT_ACCESS_ROLE_NAME_LIMIT) &&
    value.name.trim().length > 0 &&
    isLevels(value.agents) &&
    Array.isArray(value.memberIds) &&
    value.memberIds.length <= MEMBER_LIMIT &&
    value.memberIds.every(isIdentifier)
  );
}

function isRoles(value: unknown): value is AgentAccessRole[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_ACCESS_ROLE_LIMIT &&
    value.every(isRole) &&
    new Set(value.map((role) => role.id)).size === value.length
  );
}

function copyRole(role: AgentAccessRole): AgentAccessRole {
  return { id: role.id, name: role.name.trim(), agents: { ...role.agents }, memberIds: [...new Set(role.memberIds)] };
}

/** On the wire the route codec has already checked the fields; this fails closed on anything else. */
export function decodeAgentAccessSnapshot(value: unknown): AgentAccessSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isRevision(value.revision) ||
    !isLevels(value.mine) ||
    (value.everyone !== undefined && !isLevels(value.everyone)) ||
    (value.roles !== undefined && !isRoles(value.roles))
  )
    throw new Error("Invalid agent access.");
  return {
    revision: value.revision,
    mine: { ...value.mine },
    ...(value.everyone === undefined ? {} : { everyone: { ...value.everyone } }),
    ...(value.roles === undefined ? {} : { roles: value.roles.map(copyRole) }),
  };
}

export function parseAgentAccessChange(value: unknown): AgentAccessChange {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "revision" && key !== "everyone" && key !== "roles") ||
    !isRevision(value.revision) ||
    !isLevels(value.everyone) ||
    !isRoles(value.roles)
  )
    throw new Error("Invalid agent access change.");
  return { revision: value.revision, everyone: { ...value.everyone }, roles: value.roles.map(copyRole) };
}
