import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import {
  MCP_FROZEN_SERVERS_LIST_LIMIT,
  MCP_MANY_SERVERS_CAPABILITY,
} from "@openbot/contracts/team-protocol/mcp-many-servers-v1";
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
import {
  requireMcpAccess,
  requireOwnMcpServer,
  requireVisibleMcpAddress,
  requireVisibleMcpTest,
  visibleMcpServers,
} from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export function requireMcpListFits(capabilities: ReadonlySet<string>, rows: number): void {
  if (rows > MCP_FROZEN_SERVERS_LIST_LIMIT && !capabilities.has(MCP_MANY_SERVERS_CAPABILITY))
    throw new HttpError(
      409,
      sourceText("error.team.mcpServerListNeedsUpdate", { limit: MCP_FROZEN_SERVERS_LIST_LIMIT }),
    );
}

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
  if (list) {
    const servers = mcpServers.listMcpServers();
    requireMcpListFits(capabilities, servers.length);
    return json(200, visibleMcpServers(access, servers));
  }
  const body = mcpRequest(url.pathname, await readJson(request));
  if (save) {
    const input = parseSaveMcpServer(body);
    const rows = mcpServers.listMcpServers();
    const before = new Set(rows.map((server) => server.id));
    if (before.has(input.config.id)) requireOwnMcpServer(access, input.config.id);
    if (input.config.transport === "http") requireVisibleMcpAddress(access, rows, input.config.url);
    requireMcpListFits(capabilities, before.size + (before.has(input.config.id) ? 0 : 1));
    toolRuntimes?.startToolRuntimes();
    const saved = await runCauseEffect(mcpServers.saveMcpServer(input));
    const name = input.config.name.trim();
    const added = saved.find((server) => !before.has(server.id) && server.name === name);
    if (added && owners) await runCauseEffect(owners.add(added.id, member.id));
    return json(200, visibleMcpServers(access, saved));
  }
  if (remove) {
    const input = parseRemoveMcpServer(body);
    requireOwnMcpServer(access, input.mcpServerId);
    const rows = mcpServers.listMcpServers();
    requireMcpListFits(capabilities, rows.length - (rows.some((server) => server.id === input.mcpServerId) ? 1 : 0));
    const servers = await runCauseEffect(mcpServers.removeMcpServer(input));
    if (owners) await runCauseEffect(owners.remove(input.mcpServerId));
    return json(200, visibleMcpServers(access, servers));
  }
  if (test) {
    const parsed = parseTestMcpServer(body);
    requireVisibleMcpTest(access, mcpServers.listMcpServers(), parsed.config);
    if (toolRuntimes) await runCauseEffect(prepareToolRuntimeForTest(parsed.config, toolRuntimes));
    return json(
      200,
      await runCauseEffect(mcpServers.testMcpServer(parsed, { storedCredentials: true, signInPlace: "host" })),
    );
  }
  const toggled = parseSetMcpServerEnabled(body);
  requireOwnMcpServer(access, toggled.mcpServerId);
  requireMcpListFits(capabilities, mcpServers.listMcpServers().length);
  if (toggled.enabled) toolRuntimes?.startToolRuntimes();
  return json(200, visibleMcpServers(access, await runCauseEffect(mcpServers.setMcpServerEnabled(toggled))));
}
