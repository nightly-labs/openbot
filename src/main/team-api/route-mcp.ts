import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { MCP_ROUTES, mcpRequest } from "@openbot/contracts/team-protocol/mcp-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import {
  parseRemoveMcpServer,
  parseSaveMcpServer,
  parseSetMcpServerEnabled,
  parseTestMcpServer,
} from "../ipc/mcp-inputs";
import { type McpToolRuntimePreparation, prepareToolRuntimeForTest } from "../ipc/mcp-server-handlers";
import type { TeamApiMcpServerOwners, TeamApiMcpServers } from "./dependencies";
import { HttpError } from "./http-error";
import { requireMcpAccess, requireOwnMcpServer } from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The MCP servers of the machine that runs this host, managed from a joined server.
 *
 * An admin check runs on all five verbs, `list` included: a response carries every `env` value and
 * every header value the host holds, so reading is as privileged as writing. Saving an enabled
 * stdio configuration makes this machine spawn that process, and a test spawns one the caller has
 * only described. All of it was decided deliberately and is frozen by `mcp-v1`; narrowing any of it
 * needs a second capability string. `mcp-member-access-v1` is that second string the other way: with
 * it, a member gets the same routes, and changes or removes only a server that the member added.
 *
 * Every route but `test` answers with the whole list, so a client never merges a partial result.
 */
export async function routeMcpServers(
  context: TeamApiRequestContext,
  mcpServers: TeamApiMcpServers | undefined,
  toolRuntimes?: McpToolRuntimePreparation,
  owners?: TeamApiMcpServerOwners,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "GET" && url.pathname === MCP_ROUTES.list;
  const save = method === "POST" && url.pathname === MCP_ROUTES.save;
  const remove = method === "POST" && url.pathname === MCP_ROUTES.remove;
  const toggle = method === "POST" && url.pathname === MCP_ROUTES.toggle;
  const test = method === "POST" && url.pathname === MCP_ROUTES.test;
  if (!list && !save && !remove && !toggle && !test) return "unmatched";
  if (!mcpServers || !capabilities.has(MCP_SERVERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mcpUnsupported"));
  const access = requireMcpAccess(member, capabilities, owners);
  if (list) return json(200, mcpServers.listMcpServers());
  // `readJson` has already run the body through the MCP wire codec, so every field below is decoded
  // and bounded before the IPC parsers see it.
  const body = mcpRequest(url.pathname, await readJson(request));
  if (save) {
    const input = parseSaveMcpServer(body);
    const before = new Set(mcpServers.listMcpServers().map((server) => server.id));
    if (before.has(input.config.id)) requireOwnMcpServer(access, input.config.id);
    // The local save starts the runtime download; the host route shares it, or a first server
    // added remotely never gets the runtime its test and its spawn need.
    toolRuntimes?.startToolRuntimes();
    const saved = await runCauseEffect(mcpServers.saveMcpServer(input));
    // The new row is the one the list did not have, by its name: another save can add a row at the
    // same time, and a name is unique. Who added it is kept for `mcp-member-access-v1`.
    const name = input.config.name.trim();
    const added = saved.find((server) => !before.has(server.id) && server.name === name);
    if (added && owners) await runCauseEffect(owners.add(added.id, member.id));
    return json(200, saved);
  }
  if (remove) {
    const input = parseRemoveMcpServer(body);
    requireOwnMcpServer(access, input.mcpServerId);
    const servers = await runCauseEffect(mcpServers.removeMcpServer(input));
    if (owners) await runCauseEffect(owners.remove(input.mcpServerId));
    return json(200, servers);
  }
  if (test) {
    const parsed = parseTestMcpServer(body);
    if (toolRuntimes) await runCauseEffect(prepareToolRuntimeForTest(parsed.config, toolRuntimes));
    // The administrator tests the host's servers, so the host's stored sign-ins are spent - but no
    // browser opens on a machine nobody is sitting at. Only the tool count and the error travel back;
    // a server that wants a sign-in is told to the administrator as one to finish on the host.
    return json(
      200,
      await runCauseEffect(mcpServers.testMcpServer(parsed, { storedCredentials: true, signInPlace: "host" })),
    );
  }
  const toggled = parseSetMcpServerEnabled(body);
  requireOwnMcpServer(access, toggled.mcpServerId);
  if (toggled.enabled) toolRuntimes?.startToolRuntimes();
  return json(200, await runCauseEffect(mcpServers.setMcpServerEnabled(toggled)));
}
