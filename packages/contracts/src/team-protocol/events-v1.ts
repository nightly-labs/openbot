// Frozen optional events-v1 wire contract.
//
// Event management is an additive admin surface. The host keeps the source secret and webhook
// headers; only their presence and names cross this protocol. Widening one of these records needs a
// new capability instead of changing this codec.

import { EVENT_DELIVERY_ID_MAX_LENGTH } from "../ipc-events";
import { isDynamicRecord, isString } from "../runtime-values";
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
  listSources: "/v1/admin/events/sources/list",
  saveSource: "/v1/admin/events/sources/save",
  deleteSource: "/v1/admin/events/sources/delete",
  listDestinations: "/v1/admin/events/destinations/list",
  saveDestination: "/v1/admin/events/destinations/save",
  deleteDestination: "/v1/admin/events/destinations/delete",
  listActivity: "/v1/admin/events/activity",
  retryDelivery: "/v1/admin/events/deliveries/retry",
  listRoutines: "/v1/admin/events/routines/list",
  saveRoutine: "/v1/admin/events/routines/save",
  deleteRoutine: "/v1/admin/events/routines/delete",
  testRoutine: "/v1/admin/events/routines/test",
} as const;

const timestamp = string(64);
const eventType = string(256);
const eventDeliveryIdentifier: AdminDecoder = (value) => {
  const decoded = string(EVENT_DELIVERY_ID_MAX_LENGTH)(value);
  if (!isString(decoded) || decoded.length === 0) throw new Error("Invalid event delivery identifier.");
  return decoded;
};
const eventDataAt = (
  value: unknown,
  depth: number,
  budget: { remaining: number } = { remaining: 10_000 },
): TeamProtocolV2Json => {
  if (depth > 32 || budget.remaining <= 0) throw new Error("Invalid event data.");
  budget.remaining -= 1;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("Invalid event data.");
    return value.map((item) => eventDataAt(item, depth + 1, budget));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length > 10_000) throw new Error("Invalid event data.");
    return Object.fromEntries(entries.map(([key, item]) => [key, eventDataAt(item, depth + 1, budget)]));
  }
  throw new Error("Invalid event data.");
};
const eventData = (value: unknown): TeamProtocolV2Json => eventDataAt(value, 0);
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
const secretHeaders = (value: unknown): TeamProtocolV2Json => {
  if (!isDynamicRecord(value)) throw new Error("Invalid webhook headers.");
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("Invalid webhook headers.");
  return Object.fromEntries(
    entries.map(([name, headerValue]) => {
      if (name.length === 0 || name.length > 256 || !isString(headerValue) || headerValue.length > 8_192) {
        throw new Error("Invalid webhook headers.");
      }
      return [name, headerValue];
    }),
  );
};
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
const trigger = variant({
  schedule: fields({ kind: oneOf("schedule"), schedule: routineSchedule }),
  event: fields({ kind: oneOf("event"), sourceId: identifier, eventType, filters: list(filter, 128) }),
});
const owner = variant({
  agent: fields({ kind: oneOf("agent"), id: identifier }),
  channel: fields({ kind: oneOf("channel"), id: identifier }),
});
const source = fields({
  id: identifier,
  name: string(256),
  active: boolean,
  url: nullable(string(2_048)),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const destination = fields({
  id: identifier,
  name: string(256),
  active: boolean,
  url: string(2_048),
  method: oneOf("POST", "PUT", "PATCH"),
  eventTypes: list(eventType, 128),
  routineIds: list(identifier, 128),
  payloadTemplate: nullable(eventData),
  hasSecret: boolean,
  headerNames: list(string(256), 128),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const activity = fields({
  id: identifier,
  kind: oneOf("received", "routine-run", "delivery"),
  status: oneOf("accepted", "duplicate", "queued", "running", "needs-attention", "succeeded", "failed"),
  eventId: nullable(identifier),
  sourceId: nullable(identifier),
  routineId: nullable(identifier),
  runId: nullable(identifier),
  destinationId: nullable(identifier),
  deliveryId: nullable(eventDeliveryIdentifier),
  occurredAt: timestamp,
  summary: string(2_048),
});
const routine = fields({
  id: identifier,
  owner,
  name: string(256),
  instruction: string(100_000),
  active: boolean,
  timezone: string(128),
  trigger,
  limitPolicy: nullable(oneOf("wait", "skip")),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const EVENTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [EVENTS_ROUTES.status, adminRoute(empty, fields({ supported: boolean, connected: boolean }))],
  [EVENTS_ROUTES.listSources, adminRoute(empty, list(source, 1_000))],
  [
    EVENTS_ROUTES.saveSource,
    adminRoute(fields({ name: string(256), active: boolean }, { id: identifier, secret: string(4_096) }), source),
  ],
  [EVENTS_ROUTES.deleteSource, adminRoute(fields({ id: identifier }), empty)],
  [EVENTS_ROUTES.listDestinations, adminRoute(empty, list(destination, 1_000))],
  [
    EVENTS_ROUTES.saveDestination,
    adminRoute(
      fields(
        {
          name: string(256),
          active: boolean,
          url: string(2_048),
          method: oneOf("POST", "PUT", "PATCH"),
          eventTypes: list(eventType, 128),
          routineIds: list(identifier, 128),
          payloadTemplate: nullable(eventData),
        },
        { id: identifier, secret: string(4_096), headers: secretHeaders },
      ),
      destination,
    ),
  ],
  [EVENTS_ROUTES.deleteDestination, adminRoute(fields({ id: identifier }), empty)],
  [EVENTS_ROUTES.listActivity, adminRoute(fields({}, { limit: count }), list(activity, 10_000))],
  [EVENTS_ROUTES.retryDelivery, adminRoute(fields({ id: eventDeliveryIdentifier }), empty)],
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
          trigger,
        },
        { id: identifier, limitPolicy: nullable(oneOf("wait", "skip")) },
      ),
      routine,
    ),
  ],
  [EVENTS_ROUTES.deleteRoutine, adminRoute(fields({ id: identifier, owner }), empty)],
  [EVENTS_ROUTES.testRoutine, adminRoute(fields({ id: identifier, owner }), empty)],
]);
