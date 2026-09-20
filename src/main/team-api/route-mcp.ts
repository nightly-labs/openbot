import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { MCP_ROUTES, mcpRequest } from "@openbot/contracts/team-protocol/mcp-v1";
import {
  parseRemoveMcpServer,
  parseSaveMcpServer,
  parseSetMcpServerEnabled,
  parseTestMcpServer,
} from "../ipc/mcp-inputs";
import type { TeamApiMcpServers } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The MCP servers of the machine that runs this host, managed from a joined server.
 *
 * `requireAdmin` runs on all five verbs, `list` included: a response carries every `env` value and
 * every header value the host holds, so reading is as privileged as writing. Saving an enabled
 * stdio configuration makes this machine spawn that process, and a test spawns one the caller has
 * only described. All of it was decided deliberately and is frozen by `mcp-v1`; narrowing any of it
 * needs a second capability string.
 *
 * Every route but `test` answers with the whole list, so a client never merges a partial result.
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
  const test = method === "POST" && url.pathname === MCP_ROUTES.test;
  if (!list && !save && !remove && !toggle && !test) return "unmatched";
  if (!mcpServers || !capabilities.has(MCP_SERVERS_CAPABILITY))
    throw new HttpError(400, "MCP servers are not supported by this connection.");
  requireAdmin(member);
  if (list) return json(200, mcpServers.listMcpServers());
  // `readJson` has already run the body through the MCP wire codec, so every field below is decoded
  // and bounded before the IPC parsers see it.
  const body = mcpRequest(url.pathname, await readJson(request));
  if (save) return json(200, mcpServers.saveMcpServer(parseSaveMcpServer(body)));
  if (remove) return json(200, mcpServers.removeMcpServer(parseRemoveMcpServer(body)));
  // The administrator tests the host's servers, so the host's stored sign-ins are spent - but no
  // browser opens on a machine nobody is sitting at. Only the tool count and the error travel back.
  if (test) return json(200, await mcpServers.testMcpServer(parseTestMcpServer(body), { storedCredentials: true }));
  return json(200, mcpServers.setMcpServerEnabled(parseSetMcpServerEnabled(body)));
}
