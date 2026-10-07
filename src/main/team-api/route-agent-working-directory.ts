import { parseBrowseWorkingDirectory, parseSetWorkingDirectory } from "@openbot/contracts/ipc";
import {
  AGENT_WORKING_DIRECTORY_CAPABILITY,
  AGENT_WORKING_DIRECTORY_ROUTES as routes,
} from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { AgentNotFoundError } from "../agent-admin-settings";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

export async function routeAgentWorkingDirectory(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hidden: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, member, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(routes).some((route) => route === url.pathname)) return "unmatched";
  requireAdmin(member);
  const service = admin?.workingDirectory;
  if (!service || !capabilities.has(AGENT_WORKING_DIRECTORY_CAPABILITY))
    throw new HttpError(400, sourceText("error.agent.workingDirectoryUnsupported"));
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hidden);
  try {
    if (url.pathname === routes.settings) return json(200, service.read(stringField(body, "agentId")));
    if (url.pathname === routes.browse)
      return json(200, await runCauseEffect(service.browse(parseBrowseWorkingDirectory(body))));
    return json(200, await runCauseEffect(service.update(parseSetWorkingDirectory(body))));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    // Expected directory errors contain only catalog text, never a host path or an I/O cause.
    if (
      error instanceof Error &&
      [sourceText("error.agent.workingDirectoryUnavailable"), sourceText("error.agent.workingDirectoryBusy")].includes(
        error.message,
      )
    )
      throw new HttpError(400, error.message);
    throw error;
  }
}
