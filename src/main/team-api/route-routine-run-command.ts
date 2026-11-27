import {
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireListedAgent, requireVisibleBodyAgent, stringField } from "./request-helpers";

export async function routeRoutineRunCommand(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== ROUTINE_RUN_COMMAND_ROUTES.command) return "unmatched";
  const routines = admin?.routineRunCommand;
  if (!routines || !capabilities.has(ROUTINE_RUN_COMMAND_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineRunCommandUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const input = { agentId: stringField(body, "agentId"), routineId: stringField(body, "routineId") };
  requireListedAgent(routines, input.agentId);
  try {
    return json(200, { command: routines.automationRunCommand(input) });
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}
