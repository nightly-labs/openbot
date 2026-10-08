import { isRoutineSchedule, type RoutineLimitPolicy, type RoutineSchedule } from "./ipc-routines";
import { isDynamicRecord, isNumber, isString } from "./runtime-values";

/** JSON values accepted from a webhook request. */
export type EventJsonValue =
  | string
  | number
  | boolean
  | null
  | EventJsonValue[]
  | { readonly [key: string]: EventJsonValue };

/** A sender's delivery ID. Senders choose it, so the bound is wider than an ID. */
export const EVENT_DELIVERY_ID_MAX_LENGTH = 512;

export type EventScalar = string | number | boolean | null;

export interface EventStatus {
  supported: boolean;
  connected: boolean;
}

export interface EventFilter {
  /** A JSON Pointer into the request `data`. The empty pointer selects the complete value. */
  pointer: string;
  value: EventScalar;
}

export interface RoutineScheduleTrigger {
  kind: "schedule";
  schedule: RoutineSchedule;
}

/**
 * A webhook trigger belongs to one routine. The host makes its URL and signing secret. The URL is
 * null until the account service registers the route. The secret is never part of a read.
 */
export interface RoutineWebhookTrigger {
  kind: "webhook";
  url: string | null;
  /** Null accepts every event type. */
  eventType: string | null;
  filters: EventFilter[];
}

export type RoutineWebhookTriggerInput = Omit<RoutineWebhookTrigger, "url">;

export type EventRoutineTrigger = RoutineScheduleTrigger | RoutineWebhookTrigger;
export type EventRoutineTriggerInput = RoutineScheduleTrigger | RoutineWebhookTriggerInput;

export type EventRoutineOwner = { kind: "agent"; id: string } | { kind: "channel"; id: string };

export interface EventRoutine {
  id: string;
  owner: EventRoutineOwner;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  trigger: EventRoutineTrigger;
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

/** `secret` is set only when this save made a new webhook trigger. The host does not show it again. */
export interface SaveEventRoutineResult {
  routine: EventRoutine;
  secret: string | null;
}

export interface WebhookSecret {
  secret: string;
}

export interface ListEventRoutinesInput {
  owner: EventRoutineOwner;
}

/** Names one routine. Routine actions and every per-routine list use it. */
export interface EventRoutineRef {
  id: string;
  owner: EventRoutineOwner;
}

export interface ListEventActivityInput {
  owner: EventRoutineOwner;
  routineId: string;
  limit?: number;
}

/** The verified request that starts a webhook routine. Secrets and signature headers are never part of it. */
export interface EventEnvelope {
  version: 1;
  id: string;
  routineId: string;
  type: string;
  occurredAt: string;
  receivedAt: string;
  data: EventJsonValue;
}

/** Why a received request did not start a run. */
export type WebhookReceiptReason = "event-type" | "filter" | "inactive";

/** One request that the webhook of a routine received. */
export interface EventActivity {
  kind: "received";
  id: string;
  deliveryId: string;
  eventType: string;
  status: "started" | "ignored";
  reason: WebhookReceiptReason | null;
  runId: string | null;
  occurredAt: string;
}

function isEventStatus(value: unknown): value is EventStatus {
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

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isEventFilterPointer(value: unknown): value is string {
  return (
    isString(value) && value.length <= 2048 && (value === "" || (value.startsWith("/") && !/~(?![01])/u.test(value)))
  );
}

export function isEventFilter(value: unknown): value is EventFilter {
  return isDynamicRecord(value) && isEventFilterPointer(value.pointer) && isScalar(value.value);
}

export function isEventRoutineOwner(value: unknown): value is EventRoutineOwner {
  return isDynamicRecord(value) && (value.kind === "agent" || value.kind === "channel") && isString(value.id);
}

function isRoutineWebhookTriggerInput(value: unknown): value is RoutineWebhookTriggerInput {
  return (
    isDynamicRecord(value) &&
    value.kind === "webhook" &&
    isNullableString(value.eventType) &&
    Array.isArray(value.filters) &&
    value.filters.every(isEventFilter)
  );
}

function isRoutineScheduleTrigger(value: unknown): value is RoutineScheduleTrigger {
  return isDynamicRecord(value) && value.kind === "schedule" && isRoutineSchedule(value.schedule);
}

export function isEventRoutineTriggerInput(value: unknown): value is EventRoutineTriggerInput {
  return isRoutineWebhookTriggerInput(value) || isRoutineScheduleTrigger(value);
}

function isEventRoutineTrigger(value: unknown): value is EventRoutineTrigger {
  return (
    isRoutineScheduleTrigger(value) ||
    (isDynamicRecord(value) && isNullableString(value.url) && isRoutineWebhookTriggerInput(value))
  );
}

function isEventRoutine(value: unknown): value is EventRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isEventRoutineOwner(value.owner) &&
    isString(value.name) &&
    isString(value.instruction) &&
    typeof value.active === "boolean" &&
    isString(value.timezone) &&
    isEventRoutineTrigger(value.trigger) &&
    (value.limitPolicy === undefined || value.limitPolicy === "wait" || value.limitPolicy === "skip") &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

function isSaveEventRoutineResult(value: unknown): value is SaveEventRoutineResult {
  return isDynamicRecord(value) && isEventRoutine(value.routine) && isNullableString(value.secret);
}

function isWebhookSecret(value: unknown): value is WebhookSecret {
  return isDynamicRecord(value) && isString(value.secret) && value.secret.length > 0;
}

function isDeliveryId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= EVENT_DELIVERY_ID_MAX_LENGTH;
}

export function isEventActivity(value: unknown): value is EventActivity {
  if (!isDynamicRecord(value) || !isString(value.id) || !isTimestamp(value.occurredAt)) return false;
  return (
    value.kind === "received" &&
    isDeliveryId(value.deliveryId) &&
    isString(value.eventType) &&
    (value.status === "started" || value.status === "ignored") &&
    (value.reason === null ||
      value.reason === "event-type" ||
      value.reason === "filter" ||
      value.reason === "inactive") &&
    isNullableString(value.runId)
  );
}

function decodeList<T>(guard: (value: unknown) => value is T, message: string): (value: unknown) => T[] {
  return (value) => {
    if (!Array.isArray(value) || !value.every(guard)) throw new Error(message);
    return value;
  };
}

function decodeOne<T>(guard: (value: unknown) => value is T, message: string): (value: unknown) => T {
  return (value) => {
    if (!guard(value)) throw new Error(message);
    return value;
  };
}

export const decodeEventStatus = decodeOne(isEventStatus, "Invalid event status response.");
export const decodeEventActivity = decodeList(isEventActivity, "Invalid event activity response.");
export const decodeEventRoutines = decodeList(isEventRoutine, "Invalid event routine response.");
export const decodeSaveEventRoutineResult = decodeOne(isSaveEventRoutineResult, "Invalid event routine response.");
export const decodeWebhookSecret = decodeOne(isWebhookSecret, "Invalid webhook secret response.");
