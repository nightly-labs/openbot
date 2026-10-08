import type {
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import { matchingSourceKeys } from "@openbot/i18n/source";
import { type Effect, Schema } from "effect";

/** The safe error boundary shared by local and Team API event management. */
export class HostEventsFailure extends Schema.TaggedError<HostEventsFailure>()("HostEventsFailure", {
  cause: Schema.Defect(),
}) {}

/**
 * The relay refuses a route ID for good: it was revoked, or another host or account owns it. The
 * routine then needs a new route ID.
 */
export class WebhookRouteConflict extends Schema.TaggedError<WebhookRouteConflict>()("WebhookRouteConflict", {}) {}

/**
 * Returns the catalog text that the user can act on, or `null` for an internal failure. The wrapped
 * cause can contain private backend details.
 */
export function hostEventsFailureMessage(failure: HostEventsFailure): string | null {
  const cause = failure.cause;
  return cause instanceof Error && matchingSourceKeys(cause.message).length > 0 ? cause.message : null;
}

/** Webhook routines and their received deliveries. Every operation except the status is scoped to one routine owner. */
export interface HostEventsApi {
  getStatus(): Effect.Effect<EventStatus, HostEventsFailure>;
  listRoutines(input: ListEventRoutinesInput): Effect.Effect<EventRoutine[], HostEventsFailure>;
  saveRoutine(input: SaveEventRoutineInput): Effect.Effect<SaveEventRoutineResult, HostEventsFailure>;
  deleteRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  testRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  rotateSecret(input: EventRoutineRef): Effect.Effect<WebhookSecret, HostEventsFailure>;
  listActivity(input: ListEventActivityInput): Effect.Effect<EventActivity[], HostEventsFailure>;
}
