import {
  EVENT_DELIVERY_ID_MAX_LENGTH,
  type EventRoutineOwner,
  type EventRoutineRef,
  isEventJsonValue,
  isEventRoutineTriggerInput,
  isRoutineRunEventType,
  type ListEventActivityInput,
  type ListEventRoutinesInput,
  type ListWebhookDestinationsInput,
  type SaveEventRoutineInput,
  type SaveWebhookDestinationInput,
  type WebhookDeliveryRef,
  type WebhookDestinationRef,
} from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

// Each parser decodes an untrusted renderer or Team API body. A failure has only catalog text.

const invalidEventInput = () => new Error(sourceText("error.backend.webhookSettingsInvalid"));

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) throw invalidEventInput();
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidEventInput();
  return value;
}

function record(value: unknown): DynamicRecord {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return value;
}

function owner(value: unknown): EventRoutineOwner {
  const input = record(value);
  if (input.kind !== "agent" && input.kind !== "channel") throw invalidEventInput();
  return { kind: input.kind, id: requiredString(input.id, 128) };
}

function routineScope(value: unknown): { owner: EventRoutineOwner; routineId: string } {
  const input = record(value);
  return { owner: owner(input.owner), routineId: requiredString(input.routineId, 128) };
}

export function parseListEventRoutines(value: unknown): ListEventRoutinesInput {
  return { owner: owner(record(value).owner) };
}

export function parseEventRoutineRef(value: unknown): EventRoutineRef {
  const input = record(value);
  return { id: requiredString(input.id, 128), owner: owner(input.owner) };
}

export function parseSaveEventRoutine(value: unknown): SaveEventRoutineInput {
  const input = record(value);
  if (!isEventRoutineTriggerInput(input.trigger)) throw invalidEventInput();
  if (input.limitPolicy !== undefined && input.limitPolicy !== "wait" && input.limitPolicy !== "skip") {
    throw invalidEventInput();
  }
  return {
    ...(input.id === undefined ? {} : { id: requiredString(input.id, 128) }),
    owner: owner(input.owner),
    name: requiredString(input.name, 256),
    instruction: requiredString(input.instruction, 100_000),
    active: requiredBoolean(input.active),
    timezone: requiredString(input.timezone, 128),
    trigger: input.trigger,
    ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
  };
}

export const parseListWebhookDestinations: (value: unknown) => ListWebhookDestinationsInput = routineScope;

export function parseWebhookDestinationRef(value: unknown): WebhookDestinationRef {
  return { ...routineScope(value), id: requiredString(record(value).id, 128) };
}

export function parseWebhookDeliveryRef(value: unknown): WebhookDeliveryRef {
  return { ...routineScope(value), id: requiredString(record(value).id, EVENT_DELIVERY_ID_MAX_LENGTH) };
}

export function parseSaveWebhookDestination(value: unknown): SaveWebhookDestinationInput {
  const input = record(value);
  if (input.method !== "POST" && input.method !== "PUT" && input.method !== "PATCH") throw invalidEventInput();
  if (!Array.isArray(input.eventTypes) || !input.eventTypes.every(isRoutineRunEventType)) throw invalidEventInput();
  if (input.payloadTemplate !== null && !isEventJsonValue(input.payloadTemplate)) throw invalidEventInput();
  let headers: Record<string, string> | undefined;
  if (input.headers !== undefined) {
    headers = {};
    for (const [name, headerValue] of Object.entries(record(input.headers))) {
      headers[name] = requiredString(headerValue, 8_192);
    }
  }
  if (input.secret !== undefined && (typeof input.secret !== "string" || input.secret.length > 1_024)) {
    throw invalidEventInput();
  }
  return {
    ...(input.id === undefined ? {} : { id: requiredString(input.id, 128) }),
    ...routineScope(input),
    active: requiredBoolean(input.active),
    url: requiredString(input.url, 2_048),
    method: input.method,
    eventTypes: input.eventTypes,
    payloadTemplate: input.payloadTemplate,
    ...(input.secret === undefined ? {} : { secret: input.secret }),
    ...(headers === undefined ? {} : { headers }),
  };
}

export function parseListEventActivity(value: unknown): ListEventActivityInput {
  const input = record(value);
  const scope = routineScope(input);
  if (input.limit === undefined) return scope;
  if (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw invalidEventInput();
  }
  return { ...scope, limit: input.limit };
}
