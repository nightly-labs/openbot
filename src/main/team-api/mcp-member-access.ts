import {
  canAdministerServer,
  type McpAccessLevel,
  type McpServerConfig,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { MCP_MEMBER_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { mcpOAuthAccountKey } from "../../backend/mcp-oauth-provider";
import type { TeamApiMcpServerOwners } from "./dependencies";
import { HttpError } from "./http-error";
import { requireAdmin } from "./request-helpers";

export type McpMemberAccess = { memberId: string; owners: TeamApiMcpServerOwners } | null;

export function requireMcpAccess(
  member: TeamMemberSummary,
  capabilities: ReadonlySet<string>,
  owners: TeamApiMcpServerOwners | undefined,
): McpMemberAccess {
  if (canAdministerServer(member.role)) return null;
  if (!owners || !capabilities.has(MCP_MEMBER_ACCESS_CAPABILITY)) requireAdmin(member);
  return owners ? { memberId: member.id, owners } : null;
}

function memberLevel(access: NonNullable<McpMemberAccess>, mcpServerId: string): McpAccessLevel {
  if (access.owners.level) return access.owners.level(mcpServerId, access.memberId);
  return access.owners.addedBy(mcpServerId, access.memberId) ? "manage" : "use";
}

export function requireOwnMcpServer(access: McpMemberAccess, mcpServerId: string): void {
  if (access && memberLevel(access, mcpServerId) !== "manage") throw notYours();
}

export function visibleMcpServers(access: McpMemberAccess, servers: McpServerConfig[]): McpServerConfig[] {
  return access ? servers.filter((server) => seesMcpServer(access, server.id)) : servers;
}

export function seesMcpServer(access: McpMemberAccess, mcpServerId: string): boolean {
  return !access || memberLevel(access, mcpServerId) !== "none";
}

export function seesMcpAddress(access: McpMemberAccess, servers: readonly McpServerConfig[], url: string): boolean {
  if (!access) return true;
  const key = signInKey(url);
  return !servers.some(
    (server) =>
      server.transport === "http" && signInKey(server.url) === key && memberLevel(access, server.id) === "none",
  );
}

export function requireVisibleMcpAddress(
  access: McpMemberAccess,
  servers: readonly McpServerConfig[],
  url: string,
): void {
  if (!seesMcpAddress(access, servers, url)) throw notYours();
}

export function requireVisibleMcpTest(
  access: McpMemberAccess,
  servers: readonly McpServerConfig[],
  config: McpServerConfig,
): void {
  if (!access) return;
  if (servers.some((server) => server.id === config.id) && memberLevel(access, config.id) === "none") throw notYours();
  if (config.transport === "http") requireVisibleMcpAddress(access, servers, config.url);
}

export function requireOwnMcpAddress(access: McpMemberAccess, servers: readonly McpServerConfig[], url: string): void {
  if (!access) return;
  const key = signInKey(url);
  for (const server of servers)
    if (server.transport === "http" && signInKey(server.url) === key) requireOwnMcpServer(access, server.id);
}

export function requireOwnMcpSignIn(
  access: McpMemberAccess,
  servers: readonly McpServerConfig[],
  mcpServerId: string,
): void {
  if (!access) return;
  requireOwnMcpServer(access, mcpServerId);
  const row = servers.find((server) => server.id === mcpServerId);
  if (row?.transport === "http") requireOwnMcpAddress(access, servers, row.url);
}

export function mcpSignInSharedWithOthers(
  servers: readonly McpServerConfig[],
  mcpServerId: string,
  owns: (mcpServerId: string) => boolean,
): boolean {
  const row = servers.find((server) => server.id === mcpServerId);
  if (row?.transport !== "http") return false;
  const key = signInKey(row.url);
  return servers.some(
    (server) =>
      server.id !== mcpServerId && server.transport === "http" && signInKey(server.url) === key && !owns(server.id),
  );
}

function signInKey(url: string): string {
  return mcpOAuthAccountKey(url) ?? url;
}

function notYours(): HttpError {
  return new HttpError(403, sourceText("error.team.mcpServerNotYours"));
}
