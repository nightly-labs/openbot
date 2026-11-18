import { canAdministerServer, isReleasedRoutineSchedule } from "@openbot/contracts/ipc";
import {
  ROUTINE_RUN_PLACE_CAPABILITY,
  ROUTINE_RUN_PLACE_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
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

/**
 * `routine-run-place-v1`: where each routine of an agent runs. A member reads the places of an agent
 * that the member can see, and sets the place of one routine with manage access to the agent, as on
 * the released routine routes. Each member sees the routines that the released routes show them: the
 * schedule routines that those routes carry, and, for an owner or admin, the webhook routines of
 * `events-v1`. A set changes only the place: the schedule, the webhook route and its secret stay as
 * they are, and no routine card goes to the chat.
 */
export async function routeRoutineRunPlace(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateRoutine">,
  records: TeamApiRoutineRunPlaces | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(ROUTINE_RUN_PLACE_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!records || !capabilities.has(ROUTINE_RUN_PLACE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineRunPlaceUnsupported"));
  // `readJson` has already run the body through the routine-run-place wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  const owner = { kind: "agent", id: agentId } as const;
  const admin = canAdministerServer(member.role);
  const shown = (routine: OwnedRoutineRecord) =>
    routine.trigger.kind === "schedule" ? isReleasedRoutineSchedule(routine.trigger.schedule) : admin;
  if (url.pathname === ROUTINE_RUN_PLACE_ROUTES.list) {
    return json(200, {
      routines: records
        .list(owner)
        .filter(shown)
        .map((routine) => ({ routineId: routine.id, runIn: routine.runIn ?? "chat" })),
    });
  }
  requireAgentLevel(context, agentId, "manage");
  const routineId = stringField(body, "routineId");
  const runIn = body.runIn === "thread" ? "thread" : "chat";
  const current = records.get(owner, routineId);
  if (!current || !shown(current)) throw new HttpError(404, sourceText("error.backend.routineGone"));
  if ((current.runIn ?? "chat") !== runIn) setPlace(records, current);
  return json(200, { routineId, runIn });

  function setPlace(store: TeamApiRoutineRunPlaces, current: OwnedRoutineRecord): void {
    try {
      if (current.trigger.kind === "schedule") {
        // The client saved the routine on a released route just before, and that save shows its card in
        // the chat. A second card for the place would only repeat it.
        agents.updateRoutine({ agentId, routineId, runIn }, { recordConversationEvent: false });
      } else {
        // A webhook routine has no released update and no card. A null secret keeps the stored one.
        store.save(owner, routineId, {
          name: current.name,
          instruction: current.instruction,
          active: current.active,
          timezone: current.timezone,
          ...(current.limitPolicy === undefined ? {} : { limitPolicy: current.limitPolicy }),
          ...(current.missedPolicy === undefined ? {} : { missedPolicy: current.missedPolicy }),
          runIn,
          trigger: {
            kind: "webhook",
            eventType: current.trigger.eventType,
            filters: current.trigger.filters,
            secretCiphertext: null,
          },
        });
      }
    } catch (error) {
      // A stored routine that the current rules refuse is the client's problem, not a host failure.
      if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
      throw error;
    }
  }
}
