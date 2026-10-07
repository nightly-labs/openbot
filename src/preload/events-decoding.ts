import {
  type EventActivity,
  type EventRoutine,
  type EventSource,
  type EventStatus,
  isEventActivity,
  isEventRoutine,
  isEventSource,
  isEventStatus,
  isWebhookDestination,
  type WebhookDestination,
} from "@openbot/contracts/ipc-events";
import { decodeVoid } from "./app-decoding";

export { decodeVoid };

export function decodeEventStatus(value: unknown): EventStatus {
  if (!isEventStatus(value)) throw new Error("Invalid event status.");
  return value;
}

export function decodeEventSources(value: unknown): EventSource[] {
  if (!Array.isArray(value) || !value.every(isEventSource)) throw new Error("Invalid event sources.");
  return value;
}

export function decodeEventSource(value: unknown): EventSource {
  if (!isEventSource(value)) throw new Error("Invalid event source.");
  return value;
}

export function decodeEventDestinations(value: unknown): WebhookDestination[] {
  if (!Array.isArray(value) || !value.every(isWebhookDestination)) throw new Error("Invalid event destinations.");
  return value;
}

export function decodeEventDestination(value: unknown): WebhookDestination {
  if (!isWebhookDestination(value)) throw new Error("Invalid event destination.");
  return value;
}

export function decodeEventActivity(value: unknown): EventActivity[] {
  if (!Array.isArray(value) || !value.every(isEventActivity)) throw new Error("Invalid event activity.");
  return value;
}

export function decodeEventRoutines(value: unknown): EventRoutine[] {
  if (!Array.isArray(value) || !value.every(isEventRoutine)) throw new Error("Invalid event routines.");
  return value;
}

export function decodeEventRoutine(value: unknown): EventRoutine {
  if (!isEventRoutine(value)) throw new Error("Invalid event routine.");
  return value;
}
