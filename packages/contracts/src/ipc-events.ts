import { isRoutineSchedule, type RoutineLimitPolicy, type RoutineSchedule } from "./ipc-routines";
import { isDynamicRecord, isNumber, isString } from "./runtime-values";

/** JSON values accepted from an event source or used in a webhook template. */
export type EventJsonValue =
  | string
  | number
  | boolean
  | null
  | EventJsonValue[]
  | { readonly [key: string]: EventJsonValue };

/** Delivery IDs include the event transition and destination IDs, so they have a wider bound than generic IDs. */
export const EVENT_DELIVERY_ID_MAX_LENGTH = 512;

export type EventScalar = string | number | boolean | null;

export interface EventSource {
  id: string;
  name: string;
  active: boolean;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventStatus {
  supported: boolean;
  connected: boolean;
}

export interface SaveEventSourceInput {
  id?: string;
  name: string;
  active: boolean;
  /** A new secret replaces the stored secret. It is never returned by a read operation. */
  secret?: string;
}

export interface EventFilter {
  /** A JSON Pointer into `EventEnvelope.data`. The empty pointer selects the complete value. */
  pointer: string;
  value: EventScalar;
}

export interface EventRoutineTrigger {
  kind: "event";
  sourceId: string;
  eventType: string;
  filters: EventFilter[];
}

export interface EventScheduleTrigger {
  kind: "schedule";
  schedule: RoutineSchedule;
}

export type EventRoutineTriggerInput = EventScheduleTrigger | EventRoutineTrigger;

export type EventRoutineOwner = { kind: "agent"; id: string } | { kind: "channel"; id: string };

export interface EventRoutine {
  id: string;
  owner: EventRoutineOwner;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  trigger: EventRoutineTriggerInput;
  limitPolicy?: RoutineLimitPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface SaveEventRoutineInput {
  id?: string;
  owner: EventRoutineOwner;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  trigger: EventRoutineTriggerInput;
  limitPolicy?: RoutineLimitPolicy;
}

export interface ListEventActivityInput {
  limit?: number;
}

export interface EventResourceIdInput {
  id: string;
}

export interface EventDeliveryIdInput {
  id: string;
}

export interface ListEventRoutinesInput {
  owner: EventRoutineOwner;
}

export interface DeleteEventRoutineInput {
  id: string;
  owner: EventRoutineOwner;
}

export interface TestEventRoutineInput {
  id: string;
  owner: EventRoutineOwner;
}

/** A versioned event envelope. Secrets and request authentication fields are never part of it. */
export interface EventEnvelope {
  version: 1;
  id: string;
  sourceId: string;
  type: string;
  occurredAt: string;
  receivedAt: string;
  data: EventJsonValue;
}

export type WebhookMethod = "POST" | "PUT" | "PATCH";

export interface WebhookDestination {
  id: string;
  name: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: string[];
  routineIds: string[];
  payloadTemplate: EventJsonValue | null;
  hasSecret: boolean;
  headerNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveWebhookDestinationInput {
  id?: string;
  name: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: string[];
  routineIds: string[];
  payloadTemplate: EventJsonValue | null;
  /** A new signing secret replaces the stored secret. It is never returned by a read operation. */
  secret?: string;
  /** Header values are accepted only on writes and returned as `headerNames`. */
  headers?: Record<string, string>;
}

export type EventActivityKind = "received" | "routine-run" | "delivery";
export type EventActivityStatus =
  | "accepted"
  | "duplicate"
  | "queued"
  | "running"
  | "needs-attention"
  | "succeeded"
  | "failed";

export interface EventActivity {
  id: string;
  kind: EventActivityKind;
  status: EventActivityStatus;
  eventId: string | null;
  sourceId: string | null;
  routineId: string | null;
  runId: string | null;
  destinationId: string | null;
  deliveryId: string | null;
  occurredAt: string;
  summary: string;
}

export interface RoutineRunNotification {
  /** Stable transition id when several committed transitions share a run and status. */
  eventId?: string;
  eventType: "routine.run.started" | "routine.run.succeeded" | "routine.run.failed" | "routine.run.needs_attention";
  runId: string;
  routineId: string;
  routineName: string;
  status: "started" | "succeeded" | "failed" | "needs-attention";
  occurredAt: string;
}

export interface WebhookDelivery {
  id: string;
  destinationId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  nextAttemptAt: string;
  status: "queued" | "sending" | "succeeded" | "failed";
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isEventStatus(value: unknown): value is EventStatus {
  return isDynamicRecord(value) && typeof value.supported === "boolean" && typeof value.connected === "boolean";
}

export function isEventJsonValue(
  value: unknown,
  depth = 0,
  budget: { remaining: number } = { remaining: 10_000 },
): value is EventJsonValue {
  if (depth > 32 || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (isNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 10_000 && value.every((item) => isEventJsonValue(item, depth + 1, budget));
  }
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length <= 10_000 &&
    Object.values(value).every((item) => isEventJsonValue(item, depth + 1, budget))
  );
}

function isScalar(value: unknown): value is EventScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (isNumber(value) && Number.isFinite(value))
  );
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}

function isFilters(value: unknown): value is EventFilter[] {
  return (
    Array.isArray(value) &&
    value.every(
      (filter) =>
        isDynamicRecord(filter) &&
        isString(filter.pointer) &&
        filter.pointer.length <= 2048 &&
        (filter.pointer === "" || (filter.pointer.startsWith("/") && !/~(?![01])/u.test(filter.pointer))) &&
        isScalar(filter.value),
    )
  );
}

export function isEventSource(value: unknown): value is EventSource {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    typeof value.active === "boolean" &&
    (value.url === null || isString(value.url)) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

export function isEventFilter(value: unknown): value is EventFilter {
  return isDynamicRecord(value) && isString(value.pointer) && isScalar(value.value);
}

export function isEventRoutineTrigger(value: unknown): value is EventRoutineTrigger {
  return (
    isDynamicRecord(value) &&
    value.kind === "event" &&
    isString(value.sourceId) &&
    isString(value.eventType) &&
    isFilters(value.filters)
  );
}

export function isEventScheduleTrigger(value: unknown): value is EventScheduleTrigger {
  return isDynamicRecord(value) && value.kind === "schedule" && isRoutineSchedule(value.schedule);
}

export function isEventRoutineTriggerInput(value: unknown): value is EventRoutineTriggerInput {
  return isEventRoutineTrigger(value) || isEventScheduleTrigger(value);
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return (
    isDynamicRecord(value) &&
    value.version === 1 &&
    isString(value.id) &&
    isString(value.sourceId) &&
    isString(value.type) &&
    isTimestamp(value.occurredAt) &&
    isTimestamp(value.receivedAt) &&
    isEventJsonValue(value.data)
  );
}

export function isWebhookDestination(value: unknown): value is WebhookDestination {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    typeof value.active === "boolean" &&
    isString(value.url) &&
    (value.method === "POST" || value.method === "PUT" || value.method === "PATCH") &&
    Array.isArray(value.eventTypes) &&
    value.eventTypes.every(isString) &&
    Array.isArray(value.routineIds) &&
    value.routineIds.every(isString) &&
    (value.payloadTemplate === null || isEventJsonValue(value.payloadTemplate)) &&
    typeof value.hasSecret === "boolean" &&
    Array.isArray(value.headerNames) &&
    value.headerNames.every(isString) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

export function isEventRoutine(value: unknown): value is EventRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isDynamicRecord(value.owner) &&
    ((value.owner.kind === "agent" && isString(value.owner.id)) ||
      (value.owner.kind === "channel" && isString(value.owner.id))) &&
    isString(value.name) &&
    isString(value.instruction) &&
    typeof value.active === "boolean" &&
    isString(value.timezone) &&
    isEventRoutineTriggerInput(value.trigger) &&
    (value.limitPolicy === undefined || value.limitPolicy === "wait" || value.limitPolicy === "skip") &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

export function isEventActivity(value: unknown): value is EventActivity {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    (value.kind === "received" || value.kind === "routine-run" || value.kind === "delivery") &&
    (value.status === "accepted" ||
      value.status === "duplicate" ||
      value.status === "queued" ||
      value.status === "running" ||
      value.status === "needs-attention" ||
      value.status === "succeeded" ||
      value.status === "failed") &&
    (value.eventId === null || isString(value.eventId)) &&
    (value.sourceId === null || isString(value.sourceId)) &&
    (value.routineId === null || isString(value.routineId)) &&
    (value.runId === null || isString(value.runId)) &&
    (value.destinationId === null || isString(value.destinationId)) &&
    (value.deliveryId === null ||
      (isString(value.deliveryId) &&
        value.deliveryId.length > 0 &&
        value.deliveryId.length <= EVENT_DELIVERY_ID_MAX_LENGTH)) &&
    isTimestamp(value.occurredAt) &&
    isString(value.summary)
  );
}

export function decodeEventSources(value: unknown): EventSource[] {
  if (!Array.isArray(value) || !value.every(isEventSource)) throw new Error("Invalid event source response.");
  return value;
}

export function decodeEventSource(value: unknown): EventSource {
  if (!isEventSource(value)) throw new Error("Invalid event source response.");
  return value;
}

export function decodeEventStatus(value: unknown): EventStatus {
  if (!isEventStatus(value)) throw new Error("Invalid event status response.");
  return value;
}

export function decodeEventActivity(value: unknown): EventActivity[] {
  if (!Array.isArray(value) || !value.every(isEventActivity)) throw new Error("Invalid event activity response.");
  return value;
}

export function decodeEventRoutines(value: unknown): EventRoutine[] {
  if (!Array.isArray(value) || !value.every(isEventRoutine)) throw new Error("Invalid event routine response.");
  return value;
}

export function decodeEventRoutine(value: unknown): EventRoutine {
  if (!isEventRoutine(value)) throw new Error("Invalid event routine response.");
  return value;
}

export function decodeEventEnvelope(value: unknown): EventEnvelope {
  if (!isEventEnvelope(value)) throw new Error("Invalid event envelope.");
  return value;
}

export function decodeWebhookDestinations(value: unknown): WebhookDestination[] {
  if (!Array.isArray(value) || !value.every(isWebhookDestination)) {
    throw new Error("Invalid webhook destination response.");
  }
  return value;
}

export function decodeWebhookDestination(value: unknown): WebhookDestination {
  if (!isWebhookDestination(value)) throw new Error("Invalid webhook destination response.");
  return value;
}
