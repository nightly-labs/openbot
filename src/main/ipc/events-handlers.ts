import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostEventsApi } from "../host-events-api";
import {
  parseEventDeliveryId,
  parseEventResourceId,
  parseEventRoutineAction,
  parseListEventActivity,
  parseListEventRoutines,
  parseSaveEventRoutine,
  parseSaveEventSource,
  parseSaveWebhookDestination,
} from "../host-events-inputs";
import {
  decodeEventActivity,
  decodeEventDestination,
  decodeEventDestinations,
  decodeEventRoutine,
  decodeEventRoutines,
  decodeEventSource,
  decodeEventSources,
  decodeEventStatus,
} from "../remote-events-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface EventsRemoteServers {
  supportsCapability(serverId: string, capability: typeof EVENTS_CAPABILITY): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface EventsIpcDependencies {
  events: HostEventsApi;
  remoteServers: EventsRemoteServers;
}

export function eventsIpcHandlers({ events, remoteServers }: EventsIpcDependencies): Pick<IpcGroupHandlers, "events"> {
  function remote<T>(serverId: string, path: string, decoder: (value: unknown) => T, body: unknown = {}): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, EVENTS_CAPABILITY))
      throw new Error(sourceText("error.backend.eventsUnavailable"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    events: {
      getStatus: scopedQueryHandler({
        local: () => runCauseEffect(events.getStatus()),
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, EVENTS_CAPABILITY)
            ? remote(serverId, EVENTS_ROUTES.status, decodeEventStatus)
            : Promise.resolve({ supported: false, connected: false }),
      }),
      listSources: scopedQueryHandler({
        local: () => runCauseEffect(events.listSources()),
        remote: (serverId) => remote(serverId, EVENTS_ROUTES.listSources, decodeEventSources),
      }),
      saveSource: scopedHandler(parseSaveEventSource, {
        local: (input) => runCauseEffect(events.saveSource(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.saveSource, decodeEventSource, input),
      }),
      deleteSource: scopedHandler(parseEventResourceId, {
        local: (input) => runCauseEffect(events.deleteSource(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.deleteSource, decodeVoid, input),
      }),
      listDestinations: scopedQueryHandler({
        local: () => runCauseEffect(events.listDestinations()),
        remote: (serverId) => remote(serverId, EVENTS_ROUTES.listDestinations, decodeEventDestinations),
      }),
      saveDestination: scopedHandler(parseSaveWebhookDestination, {
        local: (input) => runCauseEffect(events.saveDestination(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.saveDestination, decodeEventDestination, input),
      }),
      deleteDestination: scopedHandler(parseEventResourceId, {
        local: (input) => runCauseEffect(events.deleteDestination(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.deleteDestination, decodeVoid, input),
      }),
      listActivity: scopedHandler(parseListEventActivity, {
        local: (input) => runCauseEffect(events.listActivity(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.listActivity, decodeEventActivity, input),
      }),
      retryDelivery: scopedHandler(parseEventDeliveryId, {
        local: (input) => runCauseEffect(events.retryDelivery(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.retryDelivery, decodeVoid, input),
      }),
      listRoutines: scopedHandler(parseListEventRoutines, {
        local: (input) => runCauseEffect(events.listRoutines(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.listRoutines, decodeEventRoutines, input),
      }),
      saveRoutine: scopedHandler(parseSaveEventRoutine, {
        local: (input) => runCauseEffect(events.saveRoutine(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.saveRoutine, decodeEventRoutine, input),
      }),
      deleteRoutine: scopedHandler(parseEventRoutineAction, {
        local: (input) => runCauseEffect(events.deleteRoutine(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.deleteRoutine, decodeVoid, input),
      }),
      testRoutine: scopedHandler(parseEventRoutineAction, {
        local: (input) => runCauseEffect(events.testRoutine(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.testRoutine, decodeVoid, input),
      }),
    },
  };
}
