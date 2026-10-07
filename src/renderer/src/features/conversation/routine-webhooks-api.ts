import type {
  EventRoutine,
  EventRoutineRef,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
} from "@openbot/contracts/ipc-events";
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteEventRoutine,
  deleteWebhookDestination,
  getEventStatus,
  listEventActivity,
  listEventRoutines,
  listWebhookDestinations,
  retryEventDelivery,
  rotateEventRoutineSecret,
  saveEventRoutine,
  saveWebhookDestination,
  testEventRoutine,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { RoutineWebhooksApi } from "@openbot/ui/features/conversation/RoutineWebhookNotifications";
import { Effect } from "effect";

/** The event routine operations of one host: the routines themselves, their webhooks and their activity. */
export interface EventRoutinesApi extends RoutineWebhooksApi {
  listRoutines: (input: ListEventRoutinesInput) => Promise<EventRoutine[]>;
  saveRoutine: (input: SaveEventRoutineInput) => Promise<SaveEventRoutineResult>;
  deleteRoutine: (input: EventRoutineRef) => Promise<void>;
  testRoutine: (input: EventRoutineRef) => Promise<void>;
}

/** The desktop adapter for the server-scoped `events` group. */
export function desktopEventRoutinesApi(serverId: string): EventRoutinesApi {
  const events = window.openbot.events;
  return {
    getStatus: () => events.getStatus(serverId),
    listRoutines: (input) => events.listRoutines(input, serverId),
    saveRoutine: (input) => events.saveRoutine(input, serverId),
    deleteRoutine: (input) => events.deleteRoutine(input, serverId),
    testRoutine: (input) => events.testRoutine(input, serverId),
    rotateSecret: (input) => events.rotateSecret(input, serverId),
    listDestinations: (input) => events.listDestinations(input, serverId),
    saveDestination: (input) => events.saveDestination(input, serverId),
    deleteDestination: (input) => events.deleteDestination(input, serverId),
    listActivity: (input) => events.listActivity(input, serverId),
    retryDelivery: (input) => events.retryDelivery(input, serverId),
  };
}

/** The browser adapter. A failed call rejects with the host's error, not the transport wrapper. */
export function webEventRoutinesApi(request: TeamApiRequest): EventRoutinesApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  return {
    getStatus: () => run(getEventStatus(request)),
    listRoutines: (input) => run(listEventRoutines(request, input)),
    saveRoutine: (input) => run(saveEventRoutine(request, input)),
    deleteRoutine: (input) => run(deleteEventRoutine(request, input)),
    testRoutine: (input) => run(testEventRoutine(request, input)),
    rotateSecret: (input) => run(rotateEventRoutineSecret(request, input)),
    listDestinations: (input) => run(listWebhookDestinations(request, input)),
    saveDestination: (input) => run(saveWebhookDestination(request, input)),
    deleteDestination: (input) => run(deleteWebhookDestination(request, input)),
    listActivity: (input) => run(listEventActivity(request, input)),
    retryDelivery: (input) => run(retryEventDelivery(request, input)),
  };
}
