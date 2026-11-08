import { canAdministerServer, isReleasedRoutineSchedule } from "@openbot/contracts/ipc";
import { ROUTINE_STATUS_CAPABILITY, ROUTINE_STATUS_ROUTES } from "@openbot/contracts/team-protocol/routine-status-v1";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { OwnedRoutineRecord } from "../../backend/routine-store";
import type { TeamApiAgents, TeamApiRoutineStatus } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

export async function routeRoutineStatus(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateRoutine">,
  records: TeamApiRoutineStatus | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(ROUTINE_STATUS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!records || !capabilities.has(ROUTINE_STATUS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.eventsUnavailable"));
  // The optional route codec decodes the owner and boolean before this handler runs.
  const body = await readJson(request);
  const ownerValue = body.owner;
  if (!ownerValue || typeof ownerValue !== "object" || !("kind" in ownerValue) || !("id" in ownerValue))
    throw new HttpError(400, sourceText("error.backend.webhookSettingsInvalid"));
  const owner = {
    kind: ownerValue.kind === "channel" ? ("channel" as const) : ("agent" as const),
    id: stringField(ownerValue, "id"),
  };
  if (owner.kind === "agent") {
    if (hiddenAgentIds.has(owner.id) || context.agentLevel(owner.id) === "none")
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireListedAgent(agents, owner.id);
    if (url.pathname === ROUTINE_STATUS_ROUTES.set) requireAgentLevel(context, owner.id, "manage");
  } else {
    requireAdmin(member);
  }
  if (!records.ownerExists(owner)) throw new HttpError(404, sourceText("error.backend.routineGone"));
  const shown = (routine: OwnedRoutineRecord) =>
    routine.trigger.kind === "schedule"
      ? isReleasedRoutineSchedule(routine.trigger.schedule)
      : canAdministerServer(member.role);
  if (url.pathname === ROUTINE_STATUS_ROUTES.list)
    return json(200, {
      routines: records
        .list(owner)
        .filter(shown)
        .map((routine) => ({ routineId: routine.id, silent: routine.silent ?? false })),
    });
  const routineId = stringField(body, "routineId");
  const current = records.get(owner, routineId);
  if (!current || !shown(current)) throw new HttpError(404, sourceText("error.backend.routineGone"));
  const silent = body.silent === true;
  try {
    if ((current.silent ?? false) !== silent && owner.kind === "agent" && current.trigger.kind === "schedule") {
      agents.updateRoutine({ agentId: owner.id, routineId, silent }, { recordConversationEvent: false });
    } else if ((current.silent ?? false) !== silent)
      records.save(owner, routineId, {
        name: current.name,
        instruction: current.instruction,
        active: current.active,
        timezone: current.timezone,
        limitPolicy: current.limitPolicy,
        missedPolicy: current.missedPolicy,
        runIn: current.runIn,
        silent,
        trigger: current.trigger.kind === "schedule" ? current.trigger : { ...current.trigger, secretCiphertext: null },
      });
  } catch (error) {
    if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
    throw error;
  }
  return json(200, { routineId, silent });
}
