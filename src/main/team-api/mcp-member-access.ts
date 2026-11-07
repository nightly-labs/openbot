// Who may use the MCP routes of this host (`mcp-member-access-v1`).
//
// An owner or admin may do everything. A member may use the routes only when the client and this host
// both have `mcp-member-access-v1`, so a released client keeps the admin-only routes it knows. A member
// reads the list, tests, and adds a server. A member changes, signs in, signs out, or removes only a
// server that the member added. A sign-in belongs to an address, not to a row, so each row on the
// same address must be the member's.

import { canAdministerServer, type McpServerConfig, type TeamMemberSummary } from "@openbot/contracts/ipc";
import { MCP_MEMBER_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { mcpOAuthAccountKey } from "../../backend/mcp-oauth-provider";
import type { TeamApiMcpServerOwners } from "./dependencies";
import { HttpError } from "./http-error";
import { requireAdmin } from "./request-helpers";

/** What a member may do on the MCP routes, or `null` for an owner or admin, who may do everything. */
export type McpMemberAccess = { memberId: string; owners: TeamApiMcpServerOwners } | null;

/** Lets an owner or admin in, and a member when the client and this host have `mcp-member-access-v1`. */
export function requireMcpAccess(
  member: TeamMemberSummary,
  capabilities: ReadonlySet<string>,
  owners: TeamApiMcpServerOwners | undefined,
): McpMemberAccess {
  if (canAdministerServer(member.role)) return null;
  if (!owners || !capabilities.has(MCP_MEMBER_ACCESS_CAPABILITY)) requireAdmin(member);
  return owners ? { memberId: member.id, owners } : null;
}

/** Refuses a member a row that another person added. */
export function requireOwnMcpServer(access: McpMemberAccess, mcpServerId: string): void {
  if (access && !access.owners.addedBy(mcpServerId, access.memberId)) throw notYours();
}

/** Refuses a member the sign-in of an address that a row of another person also uses. */
export function requireOwnMcpAddress(access: McpMemberAccess, servers: readonly McpServerConfig[], url: string): void {
  if (!access) return;
  const key = signInKey(url);
  for (const server of servers)
    if (server.transport === "http" && signInKey(server.url) === key) requireOwnMcpServer(access, server.id);
}

/** The sign-in of the row `mcpServerId`, for a member: each row on its address must be theirs. */
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

/** The key of the host's sign-in store: one sign-in for each address and account. */
function signInKey(url: string): string {
  return mcpOAuthAccountKey(url) ?? url;
}

function notYours(): HttpError {
  return new HttpError(403, sourceText("error.team.mcpServerNotYours"));
}
