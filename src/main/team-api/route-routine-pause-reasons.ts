import { canAdministerServer, isReleasedRoutineSchedule } from "@openbot/contracts/ipc";
import {
  ROUTINE_PAUSE_REASONS_CAPABILITY,
  ROUTINE_PAUSE_REASONS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-pause-reasons-v1";
import { sourceText } from "@openbot/i18n/source";
import type { OwnedRoutineRecord } from "../../backend/routine-store";
import type { TeamApiAgents, TeamApiRoutineRunPlaces } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireListedAgent, requireVisibleBodyAgent, stringField } from "./request-helpers";

export async function routeRoutinePauseReasons(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents">,
  records: Pick<TeamApiRoutineRunPlaces, "list"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== ROUTINE_PAUSE_REASONS_ROUTES.list) return "unmatched";
  if (!records || !capabilities.has(ROUTINE_PAUSE_REASONS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routinePauseReasonsUnsupported"));
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  const admin = canAdministerServer(member.role);
  const shown = (routine: OwnedRoutineRecord) =>
    routine.trigger.kind === "schedule" ? isReleasedRoutineSchedule(routine.trigger.schedule) : admin;
  return json(200, {
    routines: records
      .list({ kind: "agent", id: agentId })
      .flatMap((routine) =>
        routine.pausedByRun && shown(routine)
          ? [{ routineId: routine.id, scheduledFor: routine.pausedByRun.scheduledFor }]
          : [],
      ),
  });
}
