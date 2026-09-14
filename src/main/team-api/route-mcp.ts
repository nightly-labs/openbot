import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { MCP_ROUTES, mcpRequest } from "@openbot/contracts/team-protocol/mcp-v1";
import { parseRemoveMcpServer, parseSaveMcpServer, parseSetMcpServerEnabled } from "../ipc/mcp-inputs";
import type { TeamApiMcpServers } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The MCP servers of the machine that runs this host, managed from a joined server.
 *
 * `requireAdmin` runs on all four verbs, `list` included: a response carries every `env` value and
 * every header value the host holds, so reading is as privileged as writing. Saving an enabled
 * stdio configuration makes this machine spawn that process. Both were decided deliberately and
 * are frozen by `mcp-v1`; narrowing either one needs a second capability string.
 *
 * Every route answers with the whole list, so a client never merges a partial result.
 */
export async function routeMcpServers(
  context: TeamApiRequestContext,
  mcpServers: TeamApiMcpServers | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "GET" && url.pathname === MCP_ROUTES.list;
  const save = method === "POST" && url.pathname === MCP_ROUTES.save;
  const remove = method === "POST" && url.pathname === MCP_ROUTES.remove;
  const toggle = method === "POST" && url.pathname === MCP_ROUTES.toggle;
  if (!list && !save && !remove && !toggle) return "unmatched";
  if (!mcpServers || !capabilities.has(MCP_SERVERS_CAPABILITY))
    throw new HttpError(400, "MCP servers are not supported by this connection.");
  requireAdmin(member);
  if (list) return json(200, mcpServers.listMcpServers());
  // `readJson` has already run the body through the MCP wire codec, so every field below is decoded
  // and bounded before the IPC parsers see it.
  const body = mcpRequest(url.pathname, await readJson(request));
  if (save) return json(200, mcpServers.saveMcpServer(parseSaveMcpServer(body)));
  if (remove) return json(200, mcpServers.removeMcpServer(parseRemoveMcpServer(body)));
  return json(200, mcpServers.setMcpServerEnabled(parseSetMcpServerEnabled(body)));
}
