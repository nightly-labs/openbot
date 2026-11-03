import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSidebarFolderAction } from "../ipc/agent-inputs";
import type { TeamApiAgents, TeamApiSidebarLayout } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * `sidebar-folders-v1`: the sidebar layout with the parent of each folder. Any member reads and changes
 * it, as with `/v1/sidebar-layout`, and an agent that this peer cannot see cannot be placed.
 */
export async function routeSidebarFolders(
  context: TeamApiRequestContext,
  sidebarLayout: Pick<TeamApiSidebarLayout, "getSnapshot" | "mutate">,
  agents: Pick<TeamApiAgents, "sidebarChatIds">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(SIDEBAR_FOLDERS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!capabilities.has(SIDEBAR_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.sidebarFoldersUnsupported"));
  const body = await readJson(request);
  if (url.pathname === SIDEBAR_FOLDERS_ROUTES.read) return json(200, sidebarLayout.getSnapshot());
  const action = parseSidebarFolderAction(body);
  for (const agentId of [
    "agentId" in action ? action.agentId : undefined,
    "beforeAgentId" in action ? action.beforeAgentId : undefined,
  ]) {
    if (agentId && hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  }
  return json(200, await runCauseEffect(sidebarLayout.mutate(action, agents.sidebarChatIds())));
}
