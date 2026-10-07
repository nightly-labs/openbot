import type {
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutinesInput,
  ListWebhookDestinationsInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  SaveWebhookDestinationInput,
  WebhookDeliveryRef,
  WebhookDestination,
  WebhookDestinationRef,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { type Effect, Schema } from "effect";

/** The safe error boundary shared by local and Team API event management. */
export class HostEventsFailure extends Schema.TaggedError<HostEventsFailure>()("HostEventsFailure", {
  cause: Schema.Defect(),
}) {}

/** Returns only catalog text. The wrapped cause can contain private backend details. */
export function hostEventsFailureMessage(failure: HostEventsFailure): string {
  const cause = failure.cause;
  if (cause instanceof Error && matchingSourceKeys(cause.message).length > 0) return cause.message;
  return sourceText("error.backend.webhookSettingsInvalid");
}

/** Webhook routines and their notifications. Every operation except the status is scoped to one routine owner. */
export interface HostEventsApi {
  getStatus(): Effect.Effect<EventStatus, HostEventsFailure>;
  listRoutines(input: ListEventRoutinesInput): Effect.Effect<EventRoutine[], HostEventsFailure>;
  saveRoutine(input: SaveEventRoutineInput): Effect.Effect<SaveEventRoutineResult, HostEventsFailure>;
  deleteRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  testRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  rotateSecret(input: EventRoutineRef): Effect.Effect<WebhookSecret, HostEventsFailure>;
  listDestinations(input: ListWebhookDestinationsInput): Effect.Effect<WebhookDestination[], HostEventsFailure>;
  saveDestination(input: SaveWebhookDestinationInput): Effect.Effect<WebhookDestination, HostEventsFailure>;
  deleteDestination(input: WebhookDestinationRef): Effect.Effect<void, HostEventsFailure>;
  listActivity(input: ListEventActivityInput): Effect.Effect<EventActivity[], HostEventsFailure>;
  retryDelivery(input: WebhookDeliveryRef): Effect.Effect<void, HostEventsFailure>;
}
