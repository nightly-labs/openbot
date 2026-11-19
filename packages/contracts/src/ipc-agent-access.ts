import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const AGENT_ACCESS_LEVELS = ["none", "view", "chat", "manage"] as const;
export type AgentAccessLevel = (typeof AGENT_ACCESS_LEVELS)[number];

export type AgentAccessLevels = Record<string, AgentAccessLevel>;

export interface AgentAccessRole {
  id: string;
  name: string;
  agents: AgentAccessLevels;
  memberIds: string[];
}

export interface AgentAccessSnapshot {
  revision: number;
  mine: AgentAccessLevels;
  everyone?: AgentAccessLevels;
  roles?: AgentAccessRole[];
}

export interface AgentAccessChange {
  revision: number;
  everyone: AgentAccessLevels;
  roles: AgentAccessRole[];
}

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
