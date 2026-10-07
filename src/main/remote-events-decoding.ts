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

export const decodeEventStatus = (value: unknown): EventStatus => {
  if (!isEventStatus(value)) throw new Error("The remote server returned invalid event status.");
  return value;
};
export const decodeEventSources = (value: unknown): EventSource[] => {
  if (!Array.isArray(value) || !value.every(isEventSource))
    throw new Error("The remote server returned invalid event sources.");
  return value;
};
export const decodeEventSource = (value: unknown): EventSource => {
  if (!isEventSource(value)) throw new Error("The remote server returned an invalid event source.");
  return value;
};
export const decodeEventDestinations = (value: unknown): WebhookDestination[] => {
  if (!Array.isArray(value) || !value.every(isWebhookDestination)) {
    throw new Error("The remote server returned invalid event destinations.");
  }
  return value;
};
export const decodeEventDestination = (value: unknown): WebhookDestination => {
  if (!isWebhookDestination(value)) throw new Error("The remote server returned an invalid event destination.");
  return value;
};
export const decodeEventActivity = (value: unknown): EventActivity[] => {
  if (!Array.isArray(value) || !value.every(isEventActivity)) {
    throw new Error("The remote server returned invalid event activity.");
  }
  return value;
};
export const decodeEventRoutines = (value: unknown): EventRoutine[] => {
  if (!Array.isArray(value) || !value.every(isEventRoutine)) {
    throw new Error("The remote server returned invalid event routines.");
  }
  return value;
};
export const decodeEventRoutine = (value: unknown): EventRoutine => {
  if (!isEventRoutine(value)) throw new Error("The remote server returned an invalid event routine.");
  return value;
};
