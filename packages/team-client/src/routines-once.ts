// The client half of `routines-once-v1`: the one-time routines of a joined server. The released
// routine routes do not list a `once` routine and refuse its schedule, so a client adds the `once`
// list to the released one and sends each save that needs it to these routes.
import type {
  ChannelRoutine,
  CreateChannelRoutineInput,
  CreateRoutineInput,
  EventRoutine,
  EventRoutineOwner,
  Routine,
  RoutineSchedule,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  UpdateChannelRoutineInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import {
  decodeOnceAgentRoutine,
  decodeOnceAgentRoutines,
  decodeOnceChannelRoutine,
  decodeOnceChannelRoutines,
  decodeOnceEventRoutines,
  decodeOnceEventSave,
  ROUTINES_ONCE_ROUTES,
} from "@openbot/contracts/team-protocol/routines-once-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";

/** One POST to the host. The desktop and the web client each give their own transport. */
export type RoutinesOncePost = <T>(path: string, decode: (value: unknown) => T, body: TeamProtocolV2Json) => Promise<T>;

/** The error of a client that saves a `once` schedule on a host without `routines-once-v1`. */
export function routinesOnceUnsupported(): Error {
  return new Error(sourceText("error.team.routinesOnceUnsupported"));
}

export function isOnceSchedule(schedule: RoutineSchedule | undefined): boolean {
  return schedule?.kind === "once";
}

/** The released routes refuse a `once` schedule, so a host without the capability cannot save one. */
export function requireReleasedScheduleOn(schedule: RoutineSchedule | undefined, once: boolean): void {
  if (!once && isOnceSchedule(schedule)) throw routinesOnceUnsupported();
}

function post<T>(send: RoutinesOncePost, path: string, decode: (value: unknown) => T, body: unknown): Promise<T> {
  return send(path, decode, decodeTeamProtocolV2Json(body));
}

/** The `once` routines of an agent. They carry where they run: `routine-run-place-v1` leaves them out. */
export function listOnceAgentRoutines(send: RoutinesOncePost, agentId: string): Promise<Routine[]> {
  return post(send, ROUTINES_ONCE_ROUTES.list, (value) => decodeOnceAgentRoutines(value, agentId), {
    owner: { kind: "agent", id: agentId },
  });
}

export function createOnceAgentRoutine(send: RoutinesOncePost, input: CreateRoutineInput): Promise<Routine> {
  const { agentId, ...fields } = input;
  return post(send, ROUTINES_ONCE_ROUTES.create, (value) => decodeOnceAgentRoutine(value, agentId), {
    owner: { kind: "agent", id: agentId },
    ...fields,
  });
}

/** Any schedule routine of the agent: a host with the capability takes every routine update here. */
export function updateAgentRoutineOnce(send: RoutinesOncePost, input: UpdateRoutineInput): Promise<Routine> {
  const { agentId, routineId, ...fields } = input;
  return post(send, ROUTINES_ONCE_ROUTES.update, (value) => decodeOnceAgentRoutine(value, agentId), {
    owner: { kind: "agent", id: agentId },
    id: routineId,
    ...fields,
  });
}

export function listOnceChannelRoutines(send: RoutinesOncePost, channelId: string): Promise<ChannelRoutine[]> {
  return post(send, ROUTINES_ONCE_ROUTES.list, (value) => decodeOnceChannelRoutines(value, channelId), {
    owner: { kind: "channel", id: channelId },
  });
}

export function createOnceChannelRoutine(
  send: RoutinesOncePost,
  input: CreateChannelRoutineInput,
): Promise<ChannelRoutine> {
  const { channelId, ...fields } = input;
  return post(send, ROUTINES_ONCE_ROUTES.create, (value) => decodeOnceChannelRoutine(value, channelId), {
    owner: { kind: "channel", id: channelId },
    ...fields,
  });
}

/** Any schedule routine of the channel: a host with the capability takes every routine update here. */
export function updateChannelRoutineOnce(
  send: RoutinesOncePost,
  input: UpdateChannelRoutineInput,
): Promise<ChannelRoutine> {
  const { channelId, routineId, ...fields } = input;
  return post(send, ROUTINES_ONCE_ROUTES.update, (value) => decodeOnceChannelRoutine(value, channelId), {
    owner: { kind: "channel", id: channelId },
    id: routineId,
    ...fields,
  });
}

/** The `once` routines of an owner as the event routes show a routine. */
export function listOnceEventRoutines(send: RoutinesOncePost, owner: EventRoutineOwner): Promise<EventRoutine[]> {
  return post(send, ROUTINES_ONCE_ROUTES.list, (value) => decodeOnceEventRoutines(value, owner), { owner });
}

/**
 * An event save that these routes take: a new `once` schedule, or a new schedule for a routine that is
 * `once` now. A webhook trigger, and every other schedule save, stay on the event routes. Returns null
 * for those.
 */
export async function saveOnceEventRoutine(
  send: RoutinesOncePost,
  input: SaveEventRoutineInput,
): Promise<SaveEventRoutineResult | null> {
  const { id, owner, trigger, timezone, runIn, ...fields } = input;
  if (trigger.kind !== "schedule") return null;
  const place = owner.kind === "agent" && runIn !== undefined ? { runIn } : {};
  const decode = (value: unknown) => decodeOnceEventSave(value, owner);
  if (id === undefined) {
    if (!isOnceSchedule(trigger.schedule)) return null;
    return post(send, ROUTINES_ONCE_ROUTES.create, decode, {
      owner,
      ...fields,
      timezone,
      schedule: trigger.schedule,
      ...place,
    });
  }
  if (!isOnceSchedule(trigger.schedule)) {
    const once = await listOnceEventRoutines(send, owner);
    if (!once.some((routine) => routine.id === id)) return null;
  }
  // An update keeps the routine's timezone, as the routine settings of an agent and a channel do.
  return post(send, ROUTINES_ONCE_ROUTES.update, decode, {
    owner,
    id,
    ...fields,
    schedule: trigger.schedule,
    ...place,
  });
}
