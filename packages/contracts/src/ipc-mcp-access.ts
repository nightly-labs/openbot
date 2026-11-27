import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const MCP_ACCESS_LEVELS = ["none", "use", "manage"] as const;
export type McpAccessLevel = (typeof MCP_ACCESS_LEVELS)[number];

export interface McpServerAccess {
  agents: string[] | null;
  everyone: McpAccessLevel;
  roles: Record<string, McpAccessLevel>;
}

export const DEFAULT_MCP_SERVER_ACCESS: McpServerAccess = { agents: null, everyone: "use", roles: {} };

export interface McpAccessSnapshot {
  revision: number;
  mine: Record<string, McpAccessLevel>;
  servers?: Record<string, McpServerAccess>;
}

export interface McpAccessChange {
  mcpServerId: string;
  access: McpServerAccess;
}

export interface SetMcpAccessInput extends McpAccessChange {
  revision: number;
}

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
