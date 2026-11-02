import type { RoutineLimitPolicy } from "@openbot/contracts/ipc";
import { type EventFilter, type EventRoutine, isEventFilter } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { Effect } from "effect";
import type { RoutineOperationFailed } from "./routine-scheduler";

export const CREATE_WEBHOOK_ROUTINE_TOOL = "create_webhook_routine";

export const CREATE_WEBHOOK_ROUTINE_ARGUMENTS = [
  "agentId",
  "name",
  "instruction",
  "eventType",
  "filters",
  "active",
  "limitPolicy",
] as const;

export const UPDATE_WEBHOOK_ROUTINE_TOOL = "update_webhook_routine";

export const UPDATE_WEBHOOK_ROUTINE_ARGUMENTS = [
  "agentId",
  "routineId",
  "name",
  "instruction",
  "eventType",
  "filters",
  "active",
  "limitPolicy",
] as const;

/** What a sender must send, as `docs/webhooks.md` describes it. The agent passes it on to the user. */
const WEBHOOK_REQUEST_FORMAT = {
  method: "POST",
  contentType: "application/json",
  body: '{ "type": string, "occurredAt"?: ISO 8601 date-time, "data"?: any JSON value }',
  bodyLimitBytes: WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
  headers: {
    [WEBHOOK_TIMESTAMP_HEADER]: `Unix time in seconds. It must be within ${WEBHOOK_MAX_CLOCK_SKEW_SECONDS} seconds of the host clock.`,
    [WEBHOOK_DELIVERY_ID_HEADER]:
      "A unique ID for each event, up to 256 characters: a letter or a digit first, then letters, digits, '.', '_', ':' or '-'. A repeat of an ID is a duplicate.",
    [WEBHOOK_SIGNATURE_HEADER]:
      "sha256=<hex HMAC-SHA256 of '<timestamp>.<delivery ID>.<exact body bytes>', keyed with the signing secret>",
  },
  responses: {
    "202": "accepted",
    "200": "duplicate",
    "400": "the body is not the JSON above",
    "401": "bad signature, timestamp or delivery ID",
    "404": "the routine is gone",
    "413": "the body is too large",
    "503": "the host is offline or busy; retry later",
  },
};

/**
 * Saves a webhook routine through the main process, which owns the signing secret, the route limit
 * and the relay route. Without `routineId` it makes a new routine. The secret never comes back here:
 * the model must not see it.
 */
export interface WebhookRoutineWriter {
  save(input: {
    routineId?: string;
    agentId: string;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    eventType: string | null;
    filters: EventFilter[];
    limitPolicy?: RoutineLimitPolicy;
  }): Effect.Effect<EventRoutine, RoutineOperationFailed>;
}

type WebhookTriggerFields = { eventType: string | null; filters: EventFilter[] };

/**
 * The trigger fields of a tool call. A field the call leaves out keeps its value in `current`. The
 * store checks the bounds again.
 */
export function webhookToolTrigger(
  args: DynamicRecord,
  current: WebhookTriggerFields = { eventType: null, filters: [] },
): WebhookTriggerFields {
  const { eventType = current.eventType, filters = current.filters } = args;
  if (eventType !== null && (!isString(eventType) || !eventType.trim())) {
    throw new RoutineInputError("eventType must be a non-empty string or null.");
  }
  if (!Array.isArray(filters) || !filters.every(isEventFilter)) {
    throw new RoutineInputError('filters must be a list of { "pointer": JSON Pointer, "value": scalar }.');
  }
  // The receiver compares the type exactly, as the editor saves it: trimmed.
  return { eventType: eventType === null ? null : eventType.trim(), filters };
}

/** One webhook routine as `list_routines` shows it. */
export function webhookRoutineSummary(routine: {
  id: string;
  name: string;
  active: boolean;
  trigger: { eventType: string | null; filters: EventFilter[]; url: string | null };
}) {
  const { eventType, filters, url } = routine.trigger;
  return { routineId: routine.id, name: routine.name, active: routine.active, eventType, filters, url };
}

/**
 * The tool result. `cardInChat` is false when this chat has no record of the routine: it belongs to
 * another agent, or the record failed. The card shows its secret button only to a person who
 * manages the host's webhook routines in the desktop app, so the text names both ways. An update
 * keeps the secret.
 */
export function webhookRoutineToolResult(routine: EventRoutine, cardInChat: boolean, updated = false) {
  const trigger = routine.trigger.kind === "webhook" ? routine.trigger : null;
  return {
    routineId: routine.id,
    name: routine.name,
    active: routine.active,
    eventType: trigger?.eventType ?? null,
    filters: trigger?.filters ?? [],
    url: trigger?.url ?? null,
    ...(trigger?.url ? {} : { urlPending: "The URL is not ready. The routine settings show it when it is." }),
    request: WEBHOOK_REQUEST_FORMAT,
    secret: updated
      ? "The signing secret did not change. You do not have it."
      : cardInChat
        ? "You do not have the signing secret. In the desktop app, a person who manages this host's webhook routines sees a card in this chat with a button that makes it. Anyone else gets it from that person, who can also make it in the routine's settings."
        : "You do not have the signing secret. A person who manages this host's webhook routines makes it in the routine's settings in the desktop app.",
  };
}
