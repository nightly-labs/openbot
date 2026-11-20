import type { ChannelRoutine } from "../ipc-channel-routines";
import { isChannelRoutine } from "../ipc-channel-routines";
import type { EventRoutine, EventRoutineOwner, SaveEventRoutineResult } from "../ipc-events";
import type { Routine } from "../ipc-routines";
import { isRoutine } from "../ipc-routines";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";
import { decodeTeamProtocolV1HttpRequest } from "./v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "./webrtc-framing";

export const ROUTINES_ONCE_CAPABILITY = "routines-once-v1";

export const ROUTINES_ONCE_ROUTES = {
  list: "/v1/routines-once/list",
  create: "/v1/routines-once/create",
  update: "/v1/routines-once/update",
} as const;

export const ROUTINES_ONCE_LIST_LIMIT = 10_000;

const owner = variant({
  agent: fields({ kind: oneOf("agent"), id: identifier }),
  channel: fields({ kind: oneOf("channel"), id: identifier }),
});

const date: AdminDecoder = (value) => {
  if (!isString(value)) throw new Error("Invalid routine date.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid routine date.");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day)
    throw new Error("Invalid routine date.");
  return value;
};
const time: AdminDecoder = (value) => {
  if (!isString(value) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Invalid routine time.");
  return value;
};
const onceSchedule = fields({ kind: oneOf("once"), date, time });

const releasedSchedule: AdminDecoder = (value) => {
  const projected = decodeTeamProtocolV1HttpRequest("POST", "/v1/agents/channel/routines", {
    botId: "channel",
    name: "routine",
    instruction: "routine",
    active: true,
    timezone: "UTC",
    schedule: value,
  });
  return decodeTeamProtocolV2Json(projected.schedule);
};
const anySchedule: AdminDecoder = (value) =>
  isDynamicRecord(value) && value.kind === "once" ? onceSchedule(value) : releasedSchedule(value);

const name = string(80);
const instruction = string(100_000);
const timezone = string(128);
const timestamp = string(80);
const limitPolicy = oneOf("wait", "skip");
const missedPolicy = oneOf("skip", "run-once");
const runIn = oneOf("chat", "thread");

const routineOf = (schedule: AdminDecoder): AdminDecoder =>
  fields(
    {
      id: identifier,
      name,
      instruction,
      active: boolean,
      timezone,
      trigger: fields({
        id: identifier,
        routineId: identifier,
        schedule,
        nextRunAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { limitPolicy, missedPolicy, runIn },
  );
const onceRoutine = routineOf(onceSchedule);
const anyRoutine = routineOf(anySchedule);

const listResponse = fields({ routines: list(onceRoutine, ROUTINES_ONCE_LIST_LIMIT) });

export const ROUTINES_ONCE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINES_ONCE_ROUTES.list, adminRoute(fields({ owner }), listResponse)],
  [
    ROUTINES_ONCE_ROUTES.create,
    adminRoute(
      fields(
        { owner, name, instruction, active: boolean, timezone, schedule: onceSchedule },
        { limitPolicy, missedPolicy, runIn },
      ),
      fields({ routine: onceRoutine }),
    ),
  ],
  [
    ROUTINES_ONCE_ROUTES.update,
    adminRoute(
      fields(
        { owner, id: identifier },
        { name, instruction, active: boolean, schedule: anySchedule, limitPolicy, missedPolicy, runIn },
      ),
      fields({ routine: anyRoutine }),
    ),
  ],
]);

export type RoutinesOnceOwner = EventRoutineOwner;

function routinesOf(value: unknown): unknown[] {
  const decoded = listResponse(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid once routine list.");
  return decoded.routines;
}

function savedRoutine(value: unknown, decode: AdminDecoder): TeamProtocolV2Json {
  if (!isDynamicRecord(value)) throw new Error("Invalid once routine.");
  return decode(value.routine);
}

function asAgentRoutine(value: unknown, agentId: string): Routine {
  const routine = isDynamicRecord(value) ? { ...value, agentId } : value;
  if (!isRoutine(routine)) throw new Error("Invalid once routine.");
  return routine;
}

function asChannelRoutine(value: unknown, channelId: string): ChannelRoutine {
  const routine = isDynamicRecord(value) ? { ...value, channelId } : value;
  if (!isChannelRoutine(routine)) throw new Error("Invalid once routine.");
  return routine;
}

export function decodeOnceAgentRoutines(value: unknown, agentId: string): Routine[] {
  return routinesOf(value).map((routine) => asAgentRoutine(routine, agentId));
}

export function decodeOnceChannelRoutines(value: unknown, channelId: string): ChannelRoutine[] {
  return routinesOf(value).map((routine) => asChannelRoutine(routine, channelId));
}

export function decodeOnceAgentRoutine(value: unknown, agentId: string): Routine {
  return asAgentRoutine(savedRoutine(value, anyRoutine), agentId);
}

export function decodeOnceChannelRoutine(value: unknown, channelId: string): ChannelRoutine {
  return asChannelRoutine(savedRoutine(value, anyRoutine), channelId);
}

export function onceEventRoutine(routine: Routine | ChannelRoutine, routineOwner: EventRoutineOwner): EventRoutine {
  return {
    id: routine.id,
    owner: routineOwner,
    name: routine.name,
    instruction: routine.instruction,
    active: routine.active,
    timezone: routine.timezone,
    trigger: { kind: "schedule", schedule: routine.trigger.schedule },
    ...(routine.limitPolicy === undefined ? {} : { limitPolicy: routine.limitPolicy }),
    ...(routine.missedPolicy === undefined ? {} : { missedPolicy: routine.missedPolicy }),
    ...(routine.runIn === undefined ? {} : { runIn: routine.runIn }),
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
  };
}

export function decodeOnceEventRoutines(value: unknown, routineOwner: EventRoutineOwner): EventRoutine[] {
  return routinesOf(value).map((routine) =>
    onceEventRoutine(
      routineOwner.kind === "agent"
        ? asAgentRoutine(routine, routineOwner.id)
        : asChannelRoutine(routine, routineOwner.id),
      routineOwner,
    ),
  );
}

export function decodeOnceEventSave(value: unknown, routineOwner: EventRoutineOwner): SaveEventRoutineResult {
  const routine =
    routineOwner.kind === "agent"
      ? decodeOnceAgentRoutine(value, routineOwner.id)
      : decodeOnceChannelRoutine(value, routineOwner.id);
  return { routine: onceEventRoutine(routine, routineOwner), secret: null };
}
