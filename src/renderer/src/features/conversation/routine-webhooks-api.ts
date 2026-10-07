import type {
  EventActivity,
  EventSource,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
  WebhookDestination,
} from "@openbot/contracts/ipc-events";
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteEventSource,
  deleteWebhookDestination,
  getEventStatus,
  listEventActivity,
  listEventSources,
  listWebhookDestinations,
  retryEventDelivery,
  saveEventSource,
  saveWebhookDestination,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { RoutineWebhooksApi } from "@openbot/ui/features/conversation/RoutineWebhookNotifications";
import { Effect } from "effect";

export function desktopEventsApi(serverId: string): RoutineWebhooksApi {
  return {
    getStatus: () => window.openbot.events.getStatus(serverId),
    listSources: () => window.openbot.events.listSources(serverId),
    saveSource: (input) => window.openbot.events.saveSource(input, serverId),
    deleteSource: (input) => window.openbot.events.deleteSource(input, serverId),
    listDestinations: () => window.openbot.events.listDestinations(serverId),
    saveDestination: (input) => window.openbot.events.saveDestination(input, serverId),
    deleteDestination: (input) => window.openbot.events.deleteDestination(input, serverId),
    listActivity: (input) => window.openbot.events.listActivity(input ?? {}, serverId),
    retryDelivery: (input) => window.openbot.events.retryDelivery(input, serverId),
  };
}

export function webEventsApi(request: TeamApiRequest): RoutineWebhooksApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  return {
    getStatus: () => run(getEventStatus(request)),
    listSources: () => run(listEventSources(request)),
    saveSource: (input: SaveEventSourceInput): Promise<EventSource> => run(saveEventSource(request, input)),
    deleteSource: ({ id }: { id: string }) => run(deleteEventSource(request, id)),
    listDestinations: (): Promise<WebhookDestination[]> => run(listWebhookDestinations(request)),
    saveDestination: (input: SaveWebhookDestinationInput): Promise<WebhookDestination> =>
      run(saveWebhookDestination(request, input)),
    deleteDestination: ({ id }: { id: string }) => run(deleteWebhookDestination(request, id)),
    listActivity: (input?: { limit?: number }): Promise<EventActivity[]> => run(listEventActivity(request, input)),
    retryDelivery: ({ id }: { id: string }) => run(retryEventDelivery(request, id)),
  };
}
