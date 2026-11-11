import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

/** What a member can do with one MCP server. Each level includes the levels before it. */
export const MCP_ACCESS_LEVELS = ["none", "use", "manage"] as const;
export type McpAccessLevel = (typeof MCP_ACCESS_LEVELS)[number];

/**
 * Who gets one MCP server. `agents` is `null` when each agent gets the server, also an agent that is
 * added later; a list names the only agents that get it. `everyone` is the level of each member, and
 * `roles` gives a level to the members of a role, by role id. A member gets the highest of them.
 */
export interface McpServerAccess {
  agents: string[] | null;
  everyone: McpAccessLevel;
  roles: Record<string, McpAccessLevel>;
}

/** The access of a server that has no stored entry. */
export const DEFAULT_MCP_SERVER_ACCESS: McpServerAccess = { agents: null, everyone: "use", roles: {} };

/**
 * The MCP access of one server (`mcp-access-v1`), by MCP server id. `mine` holds the level of the
 * caller for each server that the caller can see. An owner or admin also gets `servers`, the stored
 * entries; a server with no entry has `DEFAULT_MCP_SERVER_ACCESS`. `revision` changes with each replace.
 */
export interface McpAccessSnapshot {
  revision: number;
  mine: Record<string, McpAccessLevel>;
  servers?: Record<string, McpServerAccess>;
}

/** The new access of one MCP server. */
export interface McpAccessChange {
  mcpServerId: string;
  access: McpServerAccess;
}

/** A full replace of the access of one MCP server. `revision` is the one the client read; the host refuses a stale one. */
export interface SetMcpAccessInput extends McpAccessChange {
  revision: number;
}

// The same bounds as mcp-access-v1.
const SERVER_LIMIT = 1000;
const AGENT_LIMIT = 1000;
const ROLE_LIMIT = 100;

export function mcpAccessRank(level: McpAccessLevel): number {
  return MCP_ACCESS_LEVELS.indexOf(level);
}

function isRevision(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isLevels(value: unknown, maximum: number): value is Record<string, McpAccessLevel> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= maximum && entries.every(([id, level]) => isIdentifier(id) && isOneOf(MCP_ACCESS_LEVELS, level))
  );
}

function isAgents(value: unknown): value is string[] | null {
  return value === null || (Array.isArray(value) && value.length <= AGENT_LIMIT && value.every(isIdentifier));
}

function isAccess(value: unknown): value is McpServerAccess {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).every((key) => key === "agents" || key === "everyone" || key === "roles") &&
    isAgents(value.agents) &&
    isOneOf(MCP_ACCESS_LEVELS, value.everyone) &&
    isLevels(value.roles, ROLE_LIMIT)
  );
}

/** A copy that names each agent once. */
export function copyMcpServerAccess(access: McpServerAccess): McpServerAccess {
  return {
    agents: access.agents === null ? null : [...new Set(access.agents)],
    everyone: access.everyone,
    roles: { ...access.roles },
  };
}

function isServers(value: unknown): value is Record<string, McpServerAccess> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= SERVER_LIMIT && entries.every(([id, access]) => isIdentifier(id) && isAccess(access));
}

/** On the wire the route codec has already checked the fields; this fails closed on anything else. */
export function decodeMcpAccessSnapshot(value: unknown): McpAccessSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isRevision(value.revision) ||
    !isLevels(value.mine, SERVER_LIMIT) ||
    (value.servers !== undefined && !isServers(value.servers))
  )
    throw new Error("Invalid MCP access.");
  return {
    revision: value.revision,
    mine: { ...value.mine },
    ...(value.servers === undefined
      ? {}
      : {
          servers: Object.fromEntries(
            Object.entries(value.servers).map(([id, access]) => [id, copyMcpServerAccess(access)]),
          ),
        }),
  };
}

export function parseSetMcpAccessInput(value: unknown): SetMcpAccessInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "revision" && key !== "mcpServerId" && key !== "access") ||
    !isRevision(value.revision) ||
    !isIdentifier(value.mcpServerId) ||
    !isAccess(value.access)
  )
    throw new Error("Invalid MCP access change.");
  return { revision: value.revision, mcpServerId: value.mcpServerId, access: copyMcpServerAccess(value.access) };
}
