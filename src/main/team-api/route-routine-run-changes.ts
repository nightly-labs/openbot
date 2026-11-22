import { canAdministerServer } from "@openbot/contracts/ipc";
import {
  ROUTINE_RUN_CHANGES_CAPABILITY,
  ROUTINE_RUN_CHANGES_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-changes-v1";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { OwnedRoutineRecord } from "../../backend/routine-store";
import type { TeamApiAgents, TeamApiRoutineRunPlaces } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  readJson,
  requireAgentLevel,
  requireListedAgent,
  requireVisibleBodyAgent,
  stringField,
} from "./request-helpers";

export async function routeRoutineRunChanges(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateRoutine">,
  records: TeamApiRoutineRunPlaces | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(ROUTINE_RUN_CHANGES_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!records || !capabilities.has(ROUTINE_RUN_CHANGES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineRunChangesUnsupported"));
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  const owner = { kind: "agent", id: agentId } as const;
  const admin = canAdministerServer(member.role);
  const shown = (routine: OwnedRoutineRecord) => routine.trigger.kind === "schedule" || admin;
  if (url.pathname === ROUTINE_RUN_CHANGES_ROUTES.list) {
    return json(200, {
      routines: records
        .list(owner)
        .filter(shown)
        .map((routine) => ({ routineId: routine.id, runsChangeRoutines: routine.runsChangeRoutines === true })),
    });
  }
  requireAgentLevel(context, agentId, "manage");
  const routineId = stringField(body, "routineId");
  const runsChangeRoutines = body.runsChangeRoutines === true;
  const current = records.get(owner, routineId);
  if (!current || !shown(current)) throw new HttpError(404, sourceText("error.backend.routineGone"));
  if ((current.runsChangeRoutines === true) !== runsChangeRoutines) setRunChanges(records, current);
  return json(200, { routineId, runsChangeRoutines });

  function setRunChanges(store: TeamApiRoutineRunPlaces, current: OwnedRoutineRecord): void {
    try {
      if (current.trigger.kind === "schedule") {
        agents.updateRoutine({ agentId, routineId, runsChangeRoutines }, { recordConversationEvent: false });
      } else {
        store.save(owner, routineId, {
          name: current.name,
          instruction: current.instruction,
          active: current.active,
          timezone: current.timezone,
          ...(current.limitPolicy === undefined ? {} : { limitPolicy: current.limitPolicy }),
          ...(current.missedPolicy === undefined ? {} : { missedPolicy: current.missedPolicy }),
          runsChangeRoutines,
          trigger: {
            kind: "webhook",
            eventType: current.trigger.eventType,
            filters: current.trigger.filters,
            secretCiphertext: null,
          },
        });
      }
    } catch (error) {
      if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
      throw error;
    }
  }
}
