import type { ServerSummary } from "@openbot/contracts/ipc";
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
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteEventRoutine,
  getEventStatus,
  giveEventRoutineSecretToAgent,
  listEventActivity,
  listEventRoutineRuns,
  listEventRoutines,
  rotateEventRoutineSecret,
  saveEventRoutine,
  sendEventRoutineTestEvent,
  setEventRoutineSecret,
  testEventRoutine,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import {
  remoteRoutineRecovery,
  serverCanAdminister,
  serverGivesWebhookSecretToAgent,
  serverSendsWebhookTests,
  serverSetsWebhookSenderSecret,
} from "../servers/server-capabilities";
import type { ConversationRuntime } from "./conversation-runtime";

export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  rotateSecret: (input: EventRoutineRef) => Promise<WebhookSecret>;
  listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]>;
  readonly sendTestEvent?: ((input: EventRoutineRef) => Promise<WebhookTestResult>) | undefined;
  readonly setSecret?: ((input: SetWebhookSecretInput) => Promise<void>) | undefined;
  readonly giveSecretToAgent?: ((input: EventRoutineRef) => Promise<AgentWebhookSecret>) | undefined;
}

export interface EventRoutinesApi extends RoutineWebhooksApi {
  listRoutines: (input: ListEventRoutinesInput) => Promise<EventRoutine[]>;
  saveRoutine: (input: SaveEventRoutineInput) => Promise<SaveEventRoutineResult>;
  deleteRoutine: (input: EventRoutineRef) => Promise<void>;
  testRoutine: (input: EventRoutineRef) => Promise<void>;
  readonly listRuns?: ((input: ListEventRoutineRunsInput) => Promise<EventRoutineRun[]>) | undefined;
}

export function desktopChatEventRoutinesApi(
  server: ServerSummary | undefined,
  runtime: ConversationRuntime | undefined,
): EventRoutinesApi | undefined {
  return !runtime && serverCanAdminister(server, "events-v1")
    ? desktopEventRoutinesApi(
        server.id,
        remoteRoutineRecovery(server),
        serverSendsWebhookTests(server),
        serverSetsWebhookSenderSecret(server),
        serverGivesWebhookSecretToAgent(server),
      )
    : undefined;
}

export function desktopEventRoutinesApi(
  serverId: string,
  recovery = false,
  tests = false,
  senderSecret = false,
  agentSecret = false,
): EventRoutinesApi {
  const events = window.openbot.events;
  return {
    ...(recovery ? { listRuns: (input: ListEventRoutineRunsInput) => events.listRoutineRuns(input, serverId) } : {}),
    ...(tests ? { sendTestEvent: (input: EventRoutineRef) => events.sendTestEvent(input, serverId) } : {}),
    ...(senderSecret ? { setSecret: (input: SetWebhookSecretInput) => events.setSecret(input, serverId) } : {}),
    ...(agentSecret
      ? { giveSecretToAgent: (input: EventRoutineRef) => events.giveSecretToAgent(input, serverId) }
      : {}),
    getStatus: () => events.getStatus(serverId),
    listRoutines: (input) => events.listRoutines(input, serverId),
    saveRoutine: (input) => events.saveRoutine(input, serverId),
    deleteRoutine: (input) => events.deleteRoutine(input, serverId),
    testRoutine: (input) => events.testRoutine(input, serverId),
    rotateSecret: (input) => events.rotateSecret(input, serverId),
    listActivity: (input) => events.listActivity(input, serverId),
  };
}

export function webEventRoutinesApi(
  request: TeamApiRequest,
  recovery: () => boolean = () => false,
  tests: () => boolean = () => false,
  senderSecret: () => boolean = () => false,
  runPlaces: () => boolean = () => false,
  once: () => boolean = () => false,
  pauseReasons: () => boolean = () => false,
  agentSecret: () => boolean = () => false,
  runChanges: () => boolean = () => false,
): EventRoutinesApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const listRuns = (input: ListEventRoutineRunsInput) => run(listEventRoutineRuns(request, input));
  const sendTestEvent = (input: EventRoutineRef) => run(sendEventRoutineTestEvent(request, input));
  const setSecret = (input: SetWebhookSecretInput) => run(setEventRoutineSecret(request, input));
  const giveSecretToAgent = (input: EventRoutineRef) => run(giveEventRoutineSecretToAgent(request, input));
  return {
    get listRuns() {
      return recovery() ? listRuns : undefined;
    },
    get sendTestEvent() {
      return tests() ? sendTestEvent : undefined;
    },
    get setSecret() {
      return senderSecret() ? setSecret : undefined;
    },
    get giveSecretToAgent() {
      return agentSecret() ? giveSecretToAgent : undefined;
    },
    getStatus: () => run(getEventStatus(request)),
    listRoutines: (input) =>
      run(listEventRoutines(request, input, recovery(), runPlaces(), once(), pauseReasons(), runChanges())),
    saveRoutine: (input) => run(saveEventRoutine(request, input, recovery(), runPlaces(), once(), runChanges())),
    deleteRoutine: (input) => run(deleteEventRoutine(request, input)),
    testRoutine: (input) => run(testEventRoutine(request, input)),
    rotateSecret: (input) => run(rotateEventRoutineSecret(request, input)),
    listActivity: (input) => run(listEventActivity(request, input)),
  };
}
