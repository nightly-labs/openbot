import { parseAddAgentFolderInput, parseAgentFolderInput, parseBrowseAgentFoldersInput } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { AGENT_FOLDERS_CAPABILITY, AGENT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireListedAgent, requireVisibleBodyAgent } from "./request-helpers";

function parsed<T>(parse: (value: unknown) => T, body: DynamicRecord): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent folder input.");
  }
}

export async function routeAgentFolders(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request } = context;
  if (method !== "POST" || !Object.values(AGENT_FOLDERS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  const folders = admin?.folders;
  if (!folders || !capabilities.has(AGENT_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentFoldersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  requireListedAgent(folders, agentId);
  try {
    return await answer(context, folders, agentId, body);
  } catch (error) {
    requireListedAgent(folders, agentId);
    throw error;
  }
}

async function answer(
  { url, json }: TeamApiRequestContext,
  folders: NonNullable<TeamApiAdmin["folders"]>,
  agentId: string,
  body: DynamicRecord,
): Promise<RouteOutcome> {
  switch (url.pathname) {
    case AGENT_FOLDERS_ROUTES.read:
      return json(200, await folders.list(agentId));
    case AGENT_FOLDERS_ROUTES.add: {
      const input = parsed(parseAddAgentFolderInput, body);
      return json(200, await folders.add(input.agentId, input.path, input.replace));
    }
    case AGENT_FOLDERS_ROUTES.remove: {
      const input = parsed(parseAgentFolderInput, body);
      return json(200, await folders.remove(input.agentId, input.path));
    }
    case AGENT_FOLDERS_ROUTES.exclude: {
      const input = parsed(parseAgentFolderInput, body);
      return json(200, await folders.exclude(input.agentId, input.path));
    }
    case AGENT_FOLDERS_ROUTES.include: {
      const input = parsed(parseAgentFolderInput, body);
      return json(200, await folders.include(input.agentId, input.path));
    }
    default: {
      const input = parsed(parseBrowseAgentFoldersInput, body);
      const listed = await folders.browse(input.path);
      if (!listed) throw new HttpError(404, sourceText("error.team.folderUnavailable"));
      return json(200, listed);
    }
  }
}
