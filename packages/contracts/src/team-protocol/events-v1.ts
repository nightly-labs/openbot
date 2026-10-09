// Frozen optional events-v1 wire contract.
//
// Webhook routine management is an additive admin surface. The host makes and keeps the signing
// secret and shows it once, in the save or rotate response. Widening one of these records needs a
// new capability instead of changing this codec.

import { EVENT_DELIVERY_ID_MAX_LENGTH } from "../ipc-events";
import { isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";
import type { TeamProtocolV2Json } from "./v2";

export const EVENTS_CAPABILITY = "events-v1";

export const EVENTS_ROUTES = {
  status: "/v1/admin/events/status",
  listRoutines: "/v1/admin/events/routines/list",
  saveRoutine: "/v1/admin/events/routines/save",
  deleteRoutine: "/v1/admin/events/routines/delete",
  testRoutine: "/v1/admin/events/routines/test",
  rotateSecret: "/v1/admin/events/routines/rotate-secret",
  listActivity: "/v1/admin/events/activity",
} as const;

const timestamp = string(64);
const eventType = string(256);
const eventDeliveryIdentifier: AdminDecoder = (value) => {
  const decoded = string(EVENT_DELIVERY_ID_MAX_LENGTH)(value);
  if (!isString(decoded) || decoded.length === 0) throw new Error("Invalid event delivery identifier.");
  return decoded;
};
const integerInRange =
  (minimum: number, maximum: number): AdminDecoder =>
  (value) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error("Invalid routine schedule.");
    }
    return value;
  };
const routineTime: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new Error("Invalid routine schedule.");
  }
  return value;
};
const routineTimestamp: AdminDecoder = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid routine schedule.");
  }
  return value;
};
const nonEmptyList =
  (decode: AdminDecoder, maximum: number): AdminDecoder =>
  (value) => {
    const decoded = list(decode, maximum)(value);
    if (!Array.isArray(decoded) || decoded.length === 0) throw new Error("Invalid routine schedule.");
    return decoded;
  };
const nonEmptyString =
  (maximum: number): AdminDecoder =>
  (value) => {
    const decoded = string(maximum)(value);
    if (!isString(decoded) || decoded.length === 0) throw new Error("Invalid routine schedule.");
    return decoded;
  };
const routineSchedule = variant({
  hourly: fields({ kind: oneOf("hourly"), minute: integerInRange(0, 59) }),
  daily: fields({ kind: oneOf("daily"), time: routineTime }),
  weekdays: fields({ kind: oneOf("weekdays"), time: routineTime }),
  weekly: fields({ kind: oneOf("weekly"), weekday: integerInRange(0, 6), time: routineTime }),
  monthly: fields({ kind: oneOf("monthly"), day: integerInRange(1, 31), time: routineTime }),
  interval: fields({
    kind: oneOf("interval"),
    amount: integerInRange(1, 100_000),
    unit: oneOf("minutes", "hours", "days"),
    anchorAt: routineTimestamp,
  }),
  advanced: fields({
    kind: oneOf("advanced"),
    months: nonEmptyList(integerInRange(1, 12), 12),
    days: variant({
      "every-day": fields({ kind: oneOf("every-day") }),
      "days-of-week": fields({ kind: oneOf("days-of-week"), days: nonEmptyList(integerInRange(0, 6), 7) }),
      "days-of-month": fields({ kind: oneOf("days-of-month"), days: nonEmptyList(integerInRange(1, 31), 31) }),
    }),
    time: variant({
      "at-time": fields({ kind: oneOf("at-time"), time: routineTime }),
      every: fields({ kind: oneOf("every"), amount: integerInRange(1, 100_000), unit: oneOf("minutes", "hours") }),
    }),
  }),
  custom: fields({ kind: oneOf("custom"), expression: nonEmptyString(255) }),
});
const eventScalar = (value: unknown): TeamProtocolV2Json => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Invalid event filter value.");
};
const jsonPointer = (value: unknown): TeamProtocolV2Json => {
  const pointer = string(2_048)(value);
  if (!isString(pointer)) throw new Error("Invalid event filter pointer.");
  if (pointer !== "" && (!pointer.startsWith("/") || /~(?![01])/u.test(pointer))) {
    throw new Error("Invalid event filter pointer.");
  }
  return pointer;
};
const filter = fields({ pointer: jsonPointer, value: eventScalar });
const filters = list(filter, 128);
const scheduleTrigger = fields({ kind: oneOf("schedule"), schedule: routineSchedule });
const triggerInput = variant({
  schedule: scheduleTrigger,
  webhook: fields({ kind: oneOf("webhook"), eventType: nullable(eventType), filters }),
});
/** A routine trigger as a read answers it. `routine-flows-v1` reads it too. */
export const routineTrigger = variant({
  schedule: scheduleTrigger,
  webhook: fields({ kind: oneOf("webhook"), url: nullable(string(2_048)), eventType: nullable(eventType), filters }),
});
const owner = variant({
  agent: fields({ kind: oneOf("agent"), id: identifier }),
  channel: fields({ kind: oneOf("channel"), id: identifier }),
});
const routineRef = fields({ id: identifier, owner });
const activity = fields({
  kind: oneOf("received"),
  id: identifier,
  deliveryId: eventDeliveryIdentifier,
  eventType,
  status: oneOf("started", "ignored"),
  reason: nullable(oneOf("event-type", "filter", "inactive")),
  runId: nullable(identifier),
  occurredAt: timestamp,
});
const routine = fields(
  {
    id: identifier,
    owner,
    name: string(256),
    instruction: string(100_000),
    active: boolean,
    timezone: string(128),
    trigger: routineTrigger,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { limitPolicy: oneOf("wait", "skip") },
);
const secret = fields({ secret: string(1_024) });

export const EVENTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [EVENTS_ROUTES.status, adminRoute(empty, fields({ supported: boolean, connected: boolean }))],
  [EVENTS_ROUTES.listRoutines, adminRoute(fields({ owner }), list(routine, 10_000))],
  [
    EVENTS_ROUTES.saveRoutine,
    adminRoute(
      fields(
        {
          owner,
          name: string(256),
          instruction: string(100_000),
          active: boolean,
          timezone: string(128),
          trigger: triggerInput,
        },
        { id: identifier, limitPolicy: oneOf("wait", "skip") },
      ),
      fields({ routine, secret: nullable(string(1_024)) }),
    ),
  ],
  [EVENTS_ROUTES.deleteRoutine, adminRoute(routineRef, empty)],
  [EVENTS_ROUTES.testRoutine, adminRoute(routineRef, empty)],
  [EVENTS_ROUTES.rotateSecret, adminRoute(routineRef, secret)],
  [
    EVENTS_ROUTES.listActivity,
    adminRoute(fields({ owner, routineId: identifier }, { limit: count }), list(activity, 10_000)),
  ],
]);
