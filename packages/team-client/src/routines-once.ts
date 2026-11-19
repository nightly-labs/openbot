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

export type RoutinesOncePost = <T>(path: string, decode: (value: unknown) => T, body: TeamProtocolV2Json) => Promise<T>;

export function routinesOnceUnsupported(): Error {
  return new Error(sourceText("error.team.routinesOnceUnsupported"));
}

export function isOnceSchedule(schedule: RoutineSchedule | undefined): boolean {
  return schedule?.kind === "once";
}

export function requireReleasedScheduleOn(schedule: RoutineSchedule | undefined, once: boolean): void {
  if (!once && isOnceSchedule(schedule)) throw routinesOnceUnsupported();
}

function post<T>(send: RoutinesOncePost, path: string, decode: (value: unknown) => T, body: unknown): Promise<T> {
  return send(path, decode, decodeTeamProtocolV2Json(body));
}

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

export function listOnceEventRoutines(send: RoutinesOncePost, owner: EventRoutineOwner): Promise<EventRoutine[]> {
  return post(send, ROUTINES_ONCE_ROUTES.list, (value) => decodeOnceEventRoutines(value, owner), { owner });
}

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
  return post(send, ROUTINES_ONCE_ROUTES.update, decode, {
    owner,
    id,
    ...fields,
    schedule: trigger.schedule,
    ...place,
  });
}
