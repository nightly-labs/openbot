import { type AgentAccessRole, MCP_SERVERS_CAPABILITY, parseSetMcpAccessInput } from "@openbot/contracts/ipc";
import { MCP_ACCESS_CAPABILITY, MCP_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/mcp-access-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { mcpAccessSnapshot } from "../mcp-access-store";
import type { TeamApiMcpAccess, TeamApiMcpServerOwners, TeamApiMcpServers } from "./dependencies";
import { HttpError } from "./http-error";
import { requireMcpAccess } from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * Which agents get each MCP server of this host, and the level of each role for it. Each person who
 * can use the MCP routes reads the levels that apply to them; an owner or admin also reads and
 * replaces the entries. A replace names the revision that the client read: the host refuses a stale one
 * with 409, so two admins do not write over each other. Frozen by `mcp-access-v1`.
 */
export async function routeMcpAccess(
  context: TeamApiRequestContext,
  mcpServers: Pick<TeamApiMcpServers, "listMcpServers"> | undefined,
  access: TeamApiMcpAccess | undefined,
  owners: TeamApiMcpServerOwners | undefined,
  roles: () => readonly AgentAccessRole[],
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || (url.pathname !== MCP_ACCESS_ROUTES.read && url.pathname !== MCP_ACCESS_ROUTES.set))
    return "unmatched";
  if (!mcpServers || !access || !capabilities.has(MCP_SERVERS_CAPABILITY) || !capabilities.has(MCP_ACCESS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mcpUnsupported"));
  requireMcpAccess(member, capabilities, owners);
  const body = await readJson(request);
  const snapshot = () =>
    mcpAccessSnapshot(
      access,
      mcpServers.listMcpServers().map((server) => server.id),
      member,
      roles(),
      (mcpServerId) => owners?.addedBy(mcpServerId, member.id) ?? false,
    );
  if (url.pathname === MCP_ACCESS_ROUTES.read) return json(200, snapshot());
  requireAdmin(member);
  let change: ReturnType<typeof parseSetMcpAccessInput>;
  try {
    change = parseSetMcpAccessInput(body);
  } catch {
    throw new HttpError(400, "Invalid MCP access change.");
  }
  const existing = new Set(mcpServers.listMcpServers().map((server) => server.id));
  if (!existing.has(change.mcpServerId)) throw new HttpError(400, "Invalid MCP access change.");
  const saved = await Effect.runPromise(Effect.result(access.set(change, existing)));
  if (Result.isFailure(saved)) {
    if (saved.failure._tag === "McpAccessStale") throw new HttpError(409, sourceText("error.team.mcpAccessStale"));
    throw saved.failure.cause;
  }
  return json(200, snapshot());
}
