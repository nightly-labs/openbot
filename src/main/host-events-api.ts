import type {
  AgentWebhookSecret,
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventRoutineRun,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  SetWebhookSecretInput,
  WebhookSecret,
  WebhookTestResult,
} from "@openbot/contracts/ipc-events";
import { matchingSourceKeys } from "@openbot/i18n/source";
import { type Effect, Schema } from "effect";

export class HostEventsFailure extends Schema.TaggedError<HostEventsFailure>()("HostEventsFailure", {
  cause: Schema.Defect(),
}) {}

export class WebhookRouteConflict extends Schema.TaggedError<WebhookRouteConflict>()("WebhookRouteConflict", {}) {}

export function hostEventsFailureMessage(failure: HostEventsFailure): string | null {
  const cause = failure.cause;
  return cause instanceof Error && matchingSourceKeys(cause.message).length > 0 ? cause.message : null;
}

export interface HostEventsApi {
  getStatus(): Effect.Effect<EventStatus, HostEventsFailure>;
  listRoutines(input: ListEventRoutinesInput): Effect.Effect<EventRoutine[], HostEventsFailure>;
  saveRoutine(input: SaveEventRoutineInput): Effect.Effect<SaveEventRoutineResult, HostEventsFailure>;
  deleteRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  testRoutine(input: EventRoutineRef): Effect.Effect<void, HostEventsFailure>;
  rotateSecret(input: EventRoutineRef): Effect.Effect<WebhookSecret, HostEventsFailure>;
  setSecret(input: SetWebhookSecretInput): Effect.Effect<void, HostEventsFailure>;
  giveSecretToAgent(input: EventRoutineRef): Effect.Effect<AgentWebhookSecret, HostEventsFailure>;
  sendTestEvent(input: EventRoutineRef): Effect.Effect<WebhookTestResult, HostEventsFailure>;
  listActivity(input: ListEventActivityInput): Effect.Effect<EventActivity[], HostEventsFailure>;
  listRoutineRuns(input: ListEventRoutineRunsInput): Effect.Effect<EventRoutineRun[], HostEventsFailure>;
}
