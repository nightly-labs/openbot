import {
  canAdministerServer,
  type EventRoutineOwner,
  isReleasedRoutineSchedule,
  type UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { ROUTINE_STATUS_CAPABILITY, ROUTINE_STATUS_ROUTES } from "@openbot/contracts/team-protocol/routine-status-v1";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { ChannelService } from "../../backend/channel-service";
import type { OwnedRoutineRecord } from "../../backend/routine-store";
import type { TeamApiAgents, TeamApiRoutineStatus } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";
import { requireChannelSettingsAccess } from "./route-channels";

function parseRoutineStatusOwner(body: DynamicRecord): EventRoutineOwner {
  const owner = body.owner;
  if (!isDynamicRecord(owner) || (owner.kind !== "agent" && owner.kind !== "channel"))
    throw new HttpError(400, sourceText("error.backend.webhookSettingsInvalid"));
  return { kind: owner.kind, id: stringField(owner, "id") };
}

function parseRoutineStatusChange(body: DynamicRecord): Required<Pick<UpdateRoutineInput, "routineId" | "silent">> {
  const routineId = stringField(body, "routineId");
  if (typeof body.silent !== "boolean") throw new HttpError(400, sourceText("error.backend.webhookSettingsInvalid"));
  return { routineId, silent: body.silent };
}

export async function routeRoutineStatus(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateRoutine">,
  records: TeamApiRoutineStatus | undefined,
  hiddenAgentIds: ReadonlySet<string>,
  channels?: Pick<ChannelService, "store">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(ROUTINE_STATUS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!records || !capabilities.has(ROUTINE_STATUS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.eventsUnavailable"));
  const body = await readJson(request);
  const owner = parseRoutineStatusOwner(body);
  if (owner.kind === "agent") {
    if (hiddenAgentIds.has(owner.id) || context.agentLevel(owner.id) === "none")
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireListedAgent(agents, owner.id);
    if (url.pathname === ROUTINE_STATUS_ROUTES.set) requireAgentLevel(context, owner.id, "manage");
  } else {
    requireChannelSettingsAccess(context, channels, owner.id, hiddenAgentIds);
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
  const { routineId, silent } = parseRoutineStatusChange(body);
  const current = records.get(owner, routineId);
  if (!current || !shown(current)) throw new HttpError(404, sourceText("error.backend.routineGone"));
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
