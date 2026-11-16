// Who may use the MCP routes of this host (`mcp-member-access-v1`).
//
// An owner or admin may do everything. A member may use the routes only when the client and this host
// both have `mcp-member-access-v1`, so a released client keeps the admin-only routes it knows. A member
// reads the list, tests, and adds a server. A member changes, signs in, signs out, or removes only a
// server that the member added. A sign-in belongs to an address, not to a row, so each row on the
// same address must be the member's.
//
// With `mcp-access-v1` on the host, the level of the member decides instead: `none` hides the server
// and refuses it, `use` gives the rights on a server of another person, and `manage` gives the rights
// on a server that the member added. `none` also refuses each test, saved row, and sign-in state on
// the address of the server, so the member cannot spend its stored sign-in or learn that it has one.

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

function memberLevel(access: NonNullable<McpMemberAccess>, mcpServerId: string): McpAccessLevel {
  if (access.owners.level) return access.owners.level(mcpServerId, access.memberId);
  return access.owners.addedBy(mcpServerId, access.memberId) ? "manage" : "use";
}

/** Refuses a member a row that the member does not manage: one that another person added, without a level of `manage`. */
export function requireOwnMcpServer(access: McpMemberAccess, mcpServerId: string): void {
  if (access && memberLevel(access, mcpServerId) !== "manage") throw notYours();
}

/** The rows that the caller can see: all of them, or for a member the rows that are not at `none`. */
export function visibleMcpServers(access: McpMemberAccess, servers: McpServerConfig[]): McpServerConfig[] {
  return access ? servers.filter((server) => seesMcpServer(access, server.id)) : servers;
}

/** Whether the caller can see the row `mcpServerId`: for a member, a row that is not at `none`. */
export function seesMcpServer(access: McpMemberAccess, mcpServerId: string): boolean {
  return !access || memberLevel(access, mcpServerId) !== "none";
}

/**
 * Whether a member may reach the stored sign-in of an address: no row on the address is at `none`
 * for the member. One row at `none` is enough, also when the member has an own row on the address:
 * the sign-in belongs to the address, so the order of the saves and the levels does not matter.
 */
export function seesMcpAddress(access: McpMemberAccess, servers: readonly McpServerConfig[], url: string): boolean {
  if (!access) return true;
  const key = signInKey(url);
  return !servers.some(
    (server) =>
      server.transport === "http" && signInKey(server.url) === key && memberLevel(access, server.id) === "none",
  );
}

/** Refuses a member an address when a row on it is at `none` for the member. */
export function requireVisibleMcpAddress(
  access: McpMemberAccess,
  servers: readonly McpServerConfig[],
  url: string,
): void {
  if (!seesMcpAddress(access, servers, url)) throw notYours();
}

/**
 * Refuses a member the test of a row at `none`. A test spends the stored sign-in of the address, so a
 * new configuration on the address of such a row is refused also.
 */
export function requireVisibleMcpTest(
  access: McpMemberAccess,
  servers: readonly McpServerConfig[],
  config: McpServerConfig,
): void {
  if (!access) return;
  if (servers.some((server) => server.id === config.id) && memberLevel(access, config.id) === "none") throw notYours();
  if (config.transport === "http") requireVisibleMcpAddress(access, servers, config.url);
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
