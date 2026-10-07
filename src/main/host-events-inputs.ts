import {
  type EventRoutineOwner,
  type EventRoutineRef,
  isEventRoutineTriggerInput,
  type ListEventActivityInput,
  type ListEventRoutinesInput,
  type SaveEventRoutineInput,
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

export function parseListEventActivity(value: unknown): ListEventActivityInput {
  const input = record(value);
  const scope = routineScope(input);
  if (input.limit === undefined) return scope;
  if (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw invalidEventInput();
  }
  return { ...scope, limit: input.limit };
}
