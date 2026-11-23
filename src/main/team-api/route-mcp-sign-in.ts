import type { McpSignInState } from "@openbot/contracts/ipc";
import { MCP_SIGN_IN_CAPABILITY, MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseCancelMcpSignIn, parseRemoveMcpServer, parseTestMcpServer } from "../ipc/mcp-inputs";
import type { TeamApiMcpServerOwners, TeamApiMcpServers, TeamApiMcpSignIns } from "./dependencies";
import { HttpError } from "./http-error";
import {
  requireMcpAccess,
  requireOwnMcpAddress,
  requireOwnMcpSignIn,
  requireVisibleMcpAddress,
  seesMcpAddress,
  seesMcpServer,
} from "./mcp-member-access";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";
import { requireMcpListFits } from "./route-mcp";

const ROUTES: ReadonlySet<string> = new Set(Object.values(MCP_SIGN_IN_ROUTES));

export async function routeMcpSignIn(
  context: TeamApiRequestContext,
  signIns: TeamApiMcpSignIns | undefined,
  mcpServers?: Pick<TeamApiMcpServers, "listMcpServers">,
  owners?: TeamApiMcpServerOwners,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!signIns || !capabilities.has(MCP_SIGN_IN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mcpUnsupported"));
  const access = requireMcpAccess(member, capabilities, owners);
  const servers = () => mcpServers?.listMcpServers() ?? [];
  const visible = (states: McpSignInState[]) => {
    const rows = servers();
    const urls = new Map(rows.map((row) => [row.id, row.transport === "http" ? row.url : null]));
    return states.filter((state) => {
      const url = urls.get(state.mcpServerId);
      return seesMcpServer(access, state.mcpServerId) && (!url || seesMcpAddress(access, rows, url));
    });
  };
  const body = await readJson(request);
  switch (url.pathname) {
    case MCP_SIGN_IN_ROUTES.start: {
      const input = parseTestMcpServer(body);
      requireOwnMcpAddress(access, servers(), input.config.url);
      await runCauseEffect(signIns.start(input));
      return json(200, {});
    }
    case MCP_SIGN_IN_ROUTES.status: {
      const { url: address } = parseCancelMcpSignIn(body);
      requireVisibleMcpAddress(access, servers(), address);
      return json(200, signIns.status(address));
    }
    case MCP_SIGN_IN_ROUTES.cancel: {
      const { url: address } = parseCancelMcpSignIn(body);
      requireOwnMcpAddress(access, servers(), address);
      signIns.cancel(address);
      return json(200, {});
    }
    case MCP_SIGN_IN_ROUTES.signOut: {
      const input = parseRemoveMcpServer(body);
      requireOwnMcpSignIn(access, servers(), input.mcpServerId);
      requireMcpListFits(capabilities, signIns.list().length);
      return json(200, visible(await runCauseEffect(signIns.signOut(input))));
    }
    default: {
      const list = signIns.list();
      requireMcpListFits(capabilities, list.length);
      return json(200, visible(list));
    }
  }
}
