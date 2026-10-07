import type {
  EventActivity,
  EventRoutine,
  EventRoutineOwner,
  EventSource,
  EventStatus,
  SaveEventRoutineInput,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
  WebhookDestination,
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

export interface HostEventsApi {
  getStatus(): Effect.Effect<EventStatus, HostEventsFailure>;
  listSources(): Effect.Effect<EventSource[], HostEventsFailure>;
  saveSource(input: SaveEventSourceInput): Effect.Effect<EventSource, HostEventsFailure>;
  deleteSource(input: { id: string }): Effect.Effect<void, HostEventsFailure>;
  listDestinations(): Effect.Effect<WebhookDestination[], HostEventsFailure>;
  saveDestination(input: SaveWebhookDestinationInput): Effect.Effect<WebhookDestination, HostEventsFailure>;
  deleteDestination(input: { id: string }): Effect.Effect<void, HostEventsFailure>;
  listActivity(input?: { limit?: number }): Effect.Effect<EventActivity[], HostEventsFailure>;
  retryDelivery(input: { id: string }): Effect.Effect<void, HostEventsFailure>;
  listRoutines(input: { owner: EventRoutineOwner }): Effect.Effect<EventRoutine[], HostEventsFailure>;
  saveRoutine(input: SaveEventRoutineInput): Effect.Effect<EventRoutine, HostEventsFailure>;
  deleteRoutine(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, HostEventsFailure>;
  testRoutine(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, HostEventsFailure>;
}
