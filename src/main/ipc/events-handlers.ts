import {
  decodeEventActivity,
  decodeEventRoutineRuns,
  decodeEventRoutines,
  decodeEventStatus,
  decodeSaveEventRoutineResult,
  decodeWebhookSecret,
  decodeWebhookTestResult,
  type EventRoutineOwner,
} from "@openbot/contracts/ipc-events";
import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import {
  ROUTINE_RECOVERY_CAPABILITY,
  ROUTINE_RECOVERY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-recovery-v1";
import {
  decodeRoutineRunPlace,
  decodeRoutineRunPlaces,
  ROUTINE_RUN_PLACE_CAPABILITY,
  ROUTINE_RUN_PLACE_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
import {
  WEBHOOK_SENDER_SECRET_CAPABILITY,
  WEBHOOK_SENDER_SECRET_ROUTES,
} from "@openbot/contracts/team-protocol/webhook-sender-secret-v1";
import { WEBHOOK_TESTS_CAPABILITY, WEBHOOK_TESTS_ROUTES } from "@openbot/contracts/team-protocol/webhook-tests-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { withRoutineRunPlaces } from "@openbot/team-client/team-api-requests";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostEventsApi } from "../host-events-api";
import {
  parseEventRoutineRef,
  parseListEventActivity,
  parseListEventRoutineRuns,
  parseListEventRoutines,
  parseSaveEventRoutine,
  parseSetWebhookSecret,
} from "../host-events-inputs";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

const runPlaceLogger = createOpenBotLogger("routine-run-place");

interface EventsRemoteServers {
  supportsCapability(
    serverId: string,
    capability:
      | typeof EVENTS_CAPABILITY
      | typeof ROUTINE_RECOVERY_CAPABILITY
      | typeof ROUTINE_RUN_PLACE_CAPABILITY
      | typeof WEBHOOK_TESTS_CAPABILITY
      | typeof WEBHOOK_SENDER_SECRET_CAPABILITY,
  ): boolean;
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
  /** A host with `routine-recovery-v1` reads and saves `missedPolicy`, which the `events-v1` routes drop. */
  function recovery(serverId: string): boolean {
    return remoteServers.supportsCapability(serverId, ROUTINE_RECOVERY_CAPABILITY);
  }
  /** A host with `routine-run-place-v1` keeps where an agent routine runs, which the event routes drop. */
  function runPlaceAgent(serverId: string, owner: EventRoutineOwner): string | null {
    return owner.kind === "agent" && remoteServers.supportsCapability(serverId, ROUTINE_RUN_PLACE_CAPABILITY)
      ? owner.id
      : null;
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
      listRoutines: scopedHandler(parseListEventRoutines, {
        local: (input) => runCauseEffect(events.listRoutines(input)),
        remote: async (input, serverId) => {
          const routines = remote(
            serverId,
            recovery(serverId) ? ROUTINE_RECOVERY_ROUTES.listRoutines : EVENTS_ROUTES.listRoutines,
            decodeEventRoutines,
            input,
          );
          const agentId = runPlaceAgent(serverId, input.owner);
          if (agentId === null) return routines;
          const [list, places] = await Promise.all([
            routines,
            remote(serverId, ROUTINE_RUN_PLACE_ROUTES.list, decodeRoutineRunPlaces, { agentId }),
          ]);
          return withRoutineRunPlaces(list, places);
        },
      }),
      saveRoutine: scopedHandler(parseSaveEventRoutine, {
        local: (input) => runCauseEffect(events.saveRoutine(input)),
        remote: async (input, serverId) => {
          const saved = await remote(
            serverId,
            recovery(serverId) ? ROUTINE_RECOVERY_ROUTES.saveRoutine : EVENTS_ROUTES.saveRoutine,
            decodeSaveEventRoutineResult,
            input,
          );
          const agentId = runPlaceAgent(serverId, input.owner);
          if (agentId === null || input.runIn === undefined) return saved;
          const placed = remote(serverId, ROUTINE_RUN_PLACE_ROUTES.set, decodeRoutineRunPlace, {
            agentId,
            routineId: saved.routine.id,
            runIn: input.runIn,
          });
          // The new routine exists, so a failed place does not fail the create: it runs in the chat,
          // and a second save does not make a second routine.
          const place =
            input.id === undefined
              ? await placed.catch(() => {
                  runPlaceLogger.warn(
                    "The run place of a new remote routine was not set. The routine runs in the chat.",
                  );
                  return { runIn: "chat" as const };
                })
              : await placed;
          return { ...saved, routine: { ...saved.routine, runIn: place.runIn } };
        },
      }),
      deleteRoutine: scopedHandler(parseEventRoutineRef, {
        local: (input) => runCauseEffect(events.deleteRoutine(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.deleteRoutine, acceptEmpty, input),
      }),
      testRoutine: scopedHandler(parseEventRoutineRef, {
        local: (input) => runCauseEffect(events.testRoutine(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.testRoutine, acceptEmpty, input),
      }),
      rotateSecret: scopedHandler(parseEventRoutineRef, {
        local: (input) => runCauseEffect(events.rotateSecret(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.rotateSecret, decodeWebhookSecret, input),
      }),
      setSecret: scopedHandler(parseSetWebhookSecret, {
        local: (input) => runCauseEffect(events.setSecret(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WEBHOOK_SENDER_SECRET_CAPABILITY))
            throw new Error(sourceText("error.backend.eventsUnavailable"));
          return remote(serverId, WEBHOOK_SENDER_SECRET_ROUTES.set, acceptEmpty, input);
        },
      }),
      sendTestEvent: scopedHandler(parseEventRoutineRef, {
        local: (input) => runCauseEffect(events.sendTestEvent(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WEBHOOK_TESTS_CAPABILITY))
            throw new Error(sourceText("error.backend.eventsUnavailable"));
          return remote(serverId, WEBHOOK_TESTS_ROUTES.send, decodeWebhookTestResult, input);
        },
      }),
      listActivity: scopedHandler(parseListEventActivity, {
        local: (input) => runCauseEffect(events.listActivity(input)),
        remote: (input, serverId) => remote(serverId, EVENTS_ROUTES.listActivity, decodeEventActivity, input),
      }),
      listRoutineRuns: scopedHandler(parseListEventRoutineRuns, {
        local: (input) => runCauseEffect(events.listRoutineRuns(input)),
        remote: (input, serverId) => {
          if (!recovery(serverId)) throw new Error(sourceText("error.backend.eventsUnavailable"));
          return remote(serverId, ROUTINE_RECOVERY_ROUTES.listRuns, decodeEventRoutineRuns, input);
        },
      }),
    },
  };
}
