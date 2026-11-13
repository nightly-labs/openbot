import {
  ROUTINE_RUNS_QUIET_CAPABILITY,
  ROUTINE_RUNS_QUIET_ROUTES,
} from "@openbot/contracts/team-protocol/routine-runs-quiet-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireListedAgent, requireVisibleBodyAgent, stringField } from "./request-helpers";

/**
 * `routine-runs-quiet-v1`: which runs of an agent's routines ended with nothing to report, so the
 * run rows of the chat can say so. A member reads it for an agent that the member can see, as the
 * released run route. The answer has only the quiet runs among the ids in the request.
 */
export async function routeRoutineRunsQuiet(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "quietRoutineRunIds">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== ROUTINE_RUNS_QUIET_ROUTES.list) return "unmatched";
  if (!capabilities.has(ROUTINE_RUNS_QUIET_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineRunsQuietUnsupported"));
  // `readJson` has already run the body through the routine-runs-quiet wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  const runIds = Array.isArray(body.runIds) ? body.runIds.filter((id): id is string => typeof id === "string") : [];
  return json(200, { runIds: agents.quietRoutineRunIds({ agentId, runIds }) });
}
