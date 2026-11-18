import { CHANNEL_CHATS_CAPABILITY, canAdministerServer, isReleasedRoutineSchedule } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { ROUTINES_ONCE_CAPABILITY, ROUTINES_ONCE_ROUTES } from "@openbot/contracts/team-protocol/routines-once-v1";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { ChannelService } from "../../backend/channel-service";
import {
  parseCreateChannelRoutine,
  parseCreateRoutine,
  parseUpdateChannelRoutine,
  parseUpdateRoutine,
} from "../ipc/agent-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireListedAgent } from "./request-helpers";
import { requireVisibleChannel } from "./route-channels";

export type RoutinesOnceAgents = Pick<
  TeamApiAgents,
  | "listAgents"
  | "listRoutines"
  | "createRoutine"
  | "updateRoutine"
  | "listChannelRoutines"
  | "createChannelRoutine"
  | "updateChannelRoutine"
>;

const ROUTE_PATHS: ReadonlySet<string> = new Set(Object.values(ROUTINES_ONCE_ROUTES));

/**
 * `routines-once-v1`: the one-time routines of an agent or a channel, which the released routine
 * routes leave out. The list gives only the `once` routines; the update changes any schedule routine
 * of the owner, so a routine can go from `once` to a released kind and back. The access is that of the
 * released routes: an agent needs manage access for a save, and a channel needs only to be seen.
 */
export async function routeRoutinesOnce(
  context: TeamApiRequestContext,
  agents: RoutinesOnceAgents,
  channels: ChannelService | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTE_PATHS.has(url.pathname)) return "unmatched";
  if (!capabilities.has(ROUTINES_ONCE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routinesOnceUnsupported"));
  // `readJson` has already run the body through the routines-once wire codec.
  const body = await readJson(request);
  const owner = ownerOf(body);
  const path = url.pathname;
  try {
    if (owner.kind === "agent") {
      const agentId = owner.id;
      if (hiddenAgentIds.has(agentId) || context.agentLevel(agentId) === "none")
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      requireListedAgent(agents, agentId);
      if (path === ROUTINES_ONCE_ROUTES.list)
        return json(200, { routines: agents.listRoutines(agentId).filter((routine) => !isReleased(routine)) });
      requireAgentLevel(context, agentId, "manage");
      if (path === ROUTINES_ONCE_ROUTES.create) {
        const input = parseCreateRoutine({ ...fieldsOf(body), agentId });
        requireOnce(input.schedule);
        return json(201, { routine: agents.createRoutine(input) });
      }
      return json(200, {
        routine: agents.updateRoutine(parseUpdateRoutine({ ...fieldsOf(body), agentId, routineId: owner.routineId })),
      });
    }
    if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
    const channelId = owner.id;
    // Owners and admins keep every channel, as on the channel routes.
    requireVisibleChannel(channels, channelId, canAdministerServer(member.role) ? new Set() : hiddenAgentIds);
    if (path === ROUTINES_ONCE_ROUTES.list)
      return json(200, { routines: agents.listChannelRoutines(channelId).filter((routine) => !isReleased(routine)) });
    // A channel routine has no place: the channel parsers leave `runIn` out.
    if (path === ROUTINES_ONCE_ROUTES.create) {
      const input = parseCreateChannelRoutine({ ...fieldsOf(body), channelId });
      requireOnce(input.schedule);
      return json(201, { routine: agents.createChannelRoutine(input) });
    }
    return json(200, {
      routine: agents.updateChannelRoutine(
        parseUpdateChannelRoutine({ ...fieldsOf(body), channelId, routineId: owner.routineId }),
      ),
    });
  } catch (error) {
    // A routine that the owner does not have, or a date that has passed, is the client's problem.
    if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

function ownerOf(body: DynamicRecord): { kind: "agent" | "channel"; id: string; routineId: string } {
  const { owner } = body;
  if (!isDynamicRecord(owner) || !isString(owner.id) || (owner.kind !== "agent" && owner.kind !== "channel"))
    throw new HttpError(400, sourceText("error.backend.routineScheduleInvalid"));
  return { kind: owner.kind, id: owner.id, routineId: isString(body.id) ? body.id : "" };
}

/** The routine fields of a body, without the owner and the routine id that the route sets itself. */
function fieldsOf(body: DynamicRecord): DynamicRecord {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== "owner" && key !== "id"));
}

function isReleased(routine: { trigger: { schedule: unknown } }): boolean {
  return isReleasedRoutineSchedule(routine.trigger.schedule);
}

/** The create route makes only `once` routines; a released kind goes to the released routes. */
function requireOnce(schedule: unknown): void {
  if (isReleasedRoutineSchedule(schedule)) throw new HttpError(400, sourceText("error.backend.routineScheduleInvalid"));
}
