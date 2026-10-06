import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  WORKSPACE_DIRECTORY_CAPABILITY,
  WORKSPACE_DIRECTORY_ROUTES,
} from "@openbot/contracts/team-protocol/workspace-directory-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { WorkspacePathRefused } from "../../backend/workspace-paths";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringField } from "./request-helpers";

const REFUSED_STATUS = { missing: 404, outside: 403, "not-file": 400, "not-directory": 400 } as const;

/**
 * A refused workspace path as the sentence a member reads, with its own status. The sentence does not
 * name the host's workspace path. Any other error stays a host fault, so the router logs it and
 * answers 500.
 */
export function rethrowWorkspacePathError(error: unknown): never {
  throw error instanceof WorkspacePathRefused
    ? new HttpError(REFUSED_STATUS[error.reason], error.memberMessage)
    : error;
}

/**
 * One folder of an agent's workspace, for the folder view of a chip. Any member can list one, as any
 * member can download a file from the workspace. The agent id is in the body, so the router's check
 * of the path does not see it, and this module refuses an agent hidden from the caller. Frozen by
 * `workspace-directory-v1`.
 */
export async function routeWorkspaceDirectory(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listWorkspaceDirectory" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== WORKSPACE_DIRECTORY_ROUTES.list) return "unmatched";
  if (!capabilities.has(WORKSPACE_DIRECTORY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.workspaceDirectoryUnsupported"));
  // `readJson` has already run the body through the workspace-directory wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  const path = stringField(body, "path", false, INPUT_LIMITS.path);
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  try {
    return json(200, await runCauseEffect(agents.listWorkspaceDirectory(agentId, path)));
  } catch (error) {
    rethrowWorkspacePathError(error);
  }
}
