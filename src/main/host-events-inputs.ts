import {
  type DeleteEventRoutineInput,
  EVENT_DELIVERY_ID_MAX_LENGTH,
  type EventDeliveryIdInput,
  type EventResourceIdInput,
  type EventRoutineOwner,
  isEventJsonValue,
  isEventRoutineTriggerInput,
  type ListEventActivityInput,
  type ListEventRoutinesInput,
  type SaveEventRoutineInput,
  type SaveEventSourceInput,
  type SaveWebhookDestinationInput,
} from "@openbot/contracts/ipc-events";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

const invalidEventInput = () => new Error(sourceText("error.backend.webhookSettingsInvalid"));

export function requiredEventString(value: unknown, _field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw invalidEventInput();
  }
  return value;
}

function eventBoolean(value: unknown, _field: string): boolean {
  if (typeof value !== "boolean") throw invalidEventInput();
  return value;
}

export function parseEventRoutineOwner(value: unknown): EventRoutineOwner {
  if (!isDynamicRecord(value) || (value.kind !== "agent" && value.kind !== "channel")) {
    throw invalidEventInput();
  }
  return { kind: value.kind, id: requiredEventString(value.id, "owner id", 128) };
}

export function parseEventResourceId(value: unknown): EventResourceIdInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return { id: requiredEventString(value.id, "resource id", 128) };
}

export function parseEventDeliveryId(value: unknown): EventDeliveryIdInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return { id: requiredEventString(value.id, "delivery id", EVENT_DELIVERY_ID_MAX_LENGTH) };
}

export function parseSaveEventSource(value: unknown): SaveEventSourceInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return {
    ...(value.id === undefined ? {} : { id: requiredEventString(value.id, "source id", 128) }),
    name: requiredEventString(value.name, "source name", 256),
    active: eventBoolean(value.active, "source active"),
    ...(value.secret === undefined ? {} : { secret: requiredEventString(value.secret, "source secret", 1_024) }),
  };
}

export function parseSaveWebhookDestination(value: unknown): SaveWebhookDestinationInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  if (value.method !== "POST" && value.method !== "PUT" && value.method !== "PATCH") {
    throw invalidEventInput();
  }
  if (!Array.isArray(value.eventTypes) || !value.eventTypes.every((item) => typeof item === "string")) {
    throw invalidEventInput();
  }
  if (!Array.isArray(value.routineIds) || !value.routineIds.every((item) => typeof item === "string")) {
    throw invalidEventInput();
  }
  let headers: Record<string, string> | undefined;
  if (value.headers !== undefined) {
    if (!isDynamicRecord(value.headers)) throw invalidEventInput();
    headers = {};
    for (const [name, headerValue] of Object.entries(value.headers)) {
      headers[name] = requiredEventString(headerValue, "header", 8_192);
    }
  }
  if (value.payloadTemplate !== null && !isEventJsonValue(value.payloadTemplate)) {
    throw invalidEventInput();
  }
  return {
    ...(value.id === undefined ? {} : { id: requiredEventString(value.id, "destination id", 128) }),
    name: requiredEventString(value.name, "destination name", 256),
    active: eventBoolean(value.active, "destination active"),
    url: requiredEventString(value.url, "destination URL", 2_048),
    method: value.method,
    eventTypes: value.eventTypes.map((item) => requiredEventString(item, "event type", 256)),
    routineIds: value.routineIds.map((item) => requiredEventString(item, "routine id", 128)),
    payloadTemplate: value.payloadTemplate === null ? null : value.payloadTemplate,
    ...(value.secret === undefined ? {} : { secret: requiredEventString(value.secret, "destination secret", 1_024) }),
    ...(headers === undefined ? {} : { headers }),
  };
}

export function parseSaveEventRoutine(value: unknown): SaveEventRoutineInput {
  if (!isDynamicRecord(value) || !isEventRoutineTriggerInput(value.trigger)) throw invalidEventInput();
  if (value.limitPolicy !== undefined && value.limitPolicy !== "wait" && value.limitPolicy !== "skip") {
    throw invalidEventInput();
  }
  return {
    ...(value.id === undefined ? {} : { id: requiredEventString(value.id, "routine id", 128) }),
    owner: parseEventRoutineOwner(value.owner),
    name: requiredEventString(value.name, "routine name", 256),
    instruction: requiredEventString(value.instruction, "routine instruction", 100_000),
    active: eventBoolean(value.active, "routine active"),
    timezone: requiredEventString(value.timezone, "routine timezone", 128),
    trigger: value.trigger,
    ...(value.limitPolicy === undefined ? {} : { limitPolicy: value.limitPolicy }),
  };
}

export function parseListEventActivity(value: unknown): ListEventActivityInput {
  if (value === undefined || value === null) return {};
  if (!isDynamicRecord(value)) throw invalidEventInput();
  if (value.limit === undefined) return {};
  if (
    typeof value.limit !== "number" ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 10_000
  ) {
    throw invalidEventInput();
  }
  return { limit: value.limit };
}

export function parseListEventRoutines(value: unknown): ListEventRoutinesInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return { owner: parseEventRoutineOwner(value.owner) };
}

export function parseEventRoutineAction(value: unknown): DeleteEventRoutineInput {
  if (!isDynamicRecord(value)) throw invalidEventInput();
  return { id: requiredEventString(value.id, "routine id", 128), owner: parseEventRoutineOwner(value.owner) };
}
