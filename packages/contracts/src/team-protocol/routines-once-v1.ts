// Frozen optional routines-once-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member reads and saves the
// one-time routines (the `once` schedule: a date and a time in the routine's timezone) of an agent or
// a channel. The released routine routes, the `events-v1` and `routine-recovery-v1` routes and the
// `routine-run-place-v1` routes do not list a `once` routine and refuse a `once` schedule; that does
// not change. The list route gives only the `once` routines of one owner, so a client adds them to
// the released list. The create route makes a `once` routine. The update route changes one schedule
// routine of the owner, and its new schedule can be `once` or a released kind, so a client with this
// capability sends each update of an agent or channel routine here: a routine can go from `once` to a
// released kind and back. A routine of an agent carries where it runs (`runIn`), because
// `routine-run-place-v1` does not list a `once` routine; a channel routine has no place. The test,
// delete and run routes of a routine stay the released ones; they take the id of a `once` routine.
// An agent that the peer cannot see, or that its protocol hides, is not found (404). A read needs
// only the agent; a create or an update needs manage access to it, as on the released routes. A
// channel needs `channel-chats-v1`, and a member who sees the channel reads and saves its routines,
// as on the channel routes. A routine that the owner does not have is refused (400). Every route is a
// POST with the owner in the body. Bounds and meaning do not follow IPC changes; widening any of it
// needs a second capability string.
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
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "./v2";

export const ROUTINES_ONCE_CAPABILITY = "routines-once-v1";

export const ROUTINES_ONCE_ROUTES = {
  list: "/v1/routines-once/list",
  create: "/v1/routines-once/create",
  update: "/v1/routines-once/update",
} as const;

/** The most `once` routines of one owner that one list carries. */
export const ROUTINES_ONCE_LIST_LIMIT = 10_000;

const owner = variant({
  agent: fields({ kind: oneOf("agent"), id: identifier }),
  channel: fields({ kind: oneOf("channel"), id: identifier }),
});

/** A calendar date, `YYYY-MM-DD`, that exists. */
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
/** A time of day, `HH:MM`, on the 24-hour clock. */
const time: AdminDecoder = (value) => {
  if (!isString(value) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Invalid routine time.");
  return value;
};
const onceSchedule = fields({ kind: oneOf("once"), date, time });

// The released schedule kinds are a union of eight shapes, and the frozen v1 codec already decodes
// them for agent routines. Lending that codec a placeholder routine keeps one description of the
// union in the repository, as `channel-chats-v1` does.
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

/** The owner of a routine on these routes. */
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

/** Decodes the answer of the list route for an agent. */
export function decodeOnceAgentRoutines(value: unknown, agentId: string): Routine[] {
  return routinesOf(value).map((routine) => asAgentRoutine(routine, agentId));
}

/** Decodes the answer of the list route for a channel. */
export function decodeOnceChannelRoutines(value: unknown, channelId: string): ChannelRoutine[] {
  return routinesOf(value).map((routine) => asChannelRoutine(routine, channelId));
}

/** Decodes the answer of the create or the update route for an agent. */
export function decodeOnceAgentRoutine(value: unknown, agentId: string): Routine {
  return asAgentRoutine(savedRoutine(value, anyRoutine), agentId);
}

/** Decodes the answer of the create or the update route for a channel. */
export function decodeOnceChannelRoutine(value: unknown, channelId: string): ChannelRoutine {
  return asChannelRoutine(savedRoutine(value, anyRoutine), channelId);
}

/** A routine of these routes as the event routes show it. A schedule routine has no secret. */
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

/** Decodes the answer of the list route as event routines. */
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

/** Decodes the answer of the create or the update route as an event save. */
export function decodeOnceEventSave(value: unknown, routineOwner: EventRoutineOwner): SaveEventRoutineResult {
  const routine =
    routineOwner.kind === "agent"
      ? decodeOnceAgentRoutine(value, routineOwner.id)
      : decodeOnceChannelRoutine(value, routineOwner.id);
  return { routine: onceEventRoutine(routine, routineOwner), secret: null };
}
