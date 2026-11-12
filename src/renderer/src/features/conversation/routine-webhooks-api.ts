import type { ServerSummary } from "@openbot/contracts/ipc";
import type {
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
  serverSendsWebhookTests,
  serverSetsWebhookSenderSecret,
} from "../servers/server-capabilities";
import type { ConversationRuntime } from "./conversation-runtime";

/** The webhook operations of one host that the routine editor uses. Every action names its routine. */
export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  rotateSecret: (input: EventRoutineRef) => Promise<WebhookSecret>;
  listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]>;
  /** Set for this computer's host and a remote host with `webhook-tests-v1`: sends one signed test event. */
  readonly sendTestEvent?: ((input: EventRoutineRef) => Promise<WebhookTestResult>) | undefined;
  /** Set for this computer's host and a remote host with `webhook-sender-secret-v1`: uses a secret that the sender made. */
  readonly setSecret?: ((input: SetWebhookSecretInput) => Promise<void>) | undefined;
}

/** The event routine operations of one host: the routines themselves, their webhooks and their activity. */
export interface EventRoutinesApi extends RoutineWebhooksApi {
  listRoutines: (input: ListEventRoutinesInput) => Promise<EventRoutine[]>;
  saveRoutine: (input: SaveEventRoutineInput) => Promise<SaveEventRoutineResult>;
  deleteRoutine: (input: EventRoutineRef) => Promise<void>;
  testRoutine: (input: EventRoutineRef) => Promise<void>;
  /**
   * Set for a remote host with `routine-recovery-v1`: the routine's runs with its missed occurrences.
   * The same host also reads and saves `missedPolicy`.
   */
  readonly listRuns?: ((input: ListEventRoutineRunsInput) => Promise<EventRoutineRun[]>) | undefined;
}

/**
 * The event API of the host of a desktop chat, when this person can manage its webhook routines.
 * A chat with a `runtime` is the browser client, which has no desktop bridge.
 */
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
      )
    : undefined;
}

/**
 * The desktop adapter for the server-scoped `events` group. Main picks the `routine-recovery-v1`
 * routes for a host that has them; `recovery` adds the run list of those routes, `tests` the
 * test event of a host that sends one, and `senderSecret` the secret that the sender made.
 */
export function desktopEventRoutinesApi(
  serverId: string,
  recovery = false,
  tests = false,
  senderSecret = false,
): EventRoutinesApi {
  const events = window.openbot.events;
  return {
    ...(recovery ? { listRuns: (input: ListEventRoutineRunsInput) => events.listRoutineRuns(input, serverId) } : {}),
    ...(tests ? { sendTestEvent: (input: EventRoutineRef) => events.sendTestEvent(input, serverId) } : {}),
    ...(senderSecret ? { setSecret: (input: SetWebhookSecretInput) => events.setSecret(input, serverId) } : {}),
    getStatus: () => events.getStatus(serverId),
    listRoutines: (input) => events.listRoutines(input, serverId),
    saveRoutine: (input) => events.saveRoutine(input, serverId),
    deleteRoutine: (input) => events.deleteRoutine(input, serverId),
    testRoutine: (input) => events.testRoutine(input, serverId),
    rotateSecret: (input) => events.rotateSecret(input, serverId),
    listActivity: (input) => events.listActivity(input, serverId),
  };
}

/**
 * The browser adapter. A failed call rejects with the host's error, not the transport wrapper.
 * `recovery`, `tests`, `senderSecret`, `runPlaces` and `once` read at call time whether the connected
 * host has `routine-recovery-v1`, `webhook-tests-v1`, `webhook-sender-secret-v1`,
 * `routine-run-place-v1` and `routines-once-v1`.
 */
export function webEventRoutinesApi(
  request: TeamApiRequest,
  recovery: () => boolean = () => false,
  tests: () => boolean = () => false,
  senderSecret: () => boolean = () => false,
  runPlaces: () => boolean = () => false,
  once: () => boolean = () => false,
): EventRoutinesApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const listRuns = (input: ListEventRoutineRunsInput) => run(listEventRoutineRuns(request, input));
  const sendTestEvent = (input: EventRoutineRef) => run(sendEventRoutineTestEvent(request, input));
  const setSecret = (input: SetWebhookSecretInput) => run(setEventRoutineSecret(request, input));
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
    getStatus: () => run(getEventStatus(request)),
    listRoutines: (input) => run(listEventRoutines(request, input, recovery(), runPlaces(), once())),
    saveRoutine: (input) => run(saveEventRoutine(request, input, recovery(), runPlaces(), once())),
    deleteRoutine: (input) => run(deleteEventRoutine(request, input)),
    testRoutine: (input) => run(testEventRoutine(request, input)),
    rotateSecret: (input) => run(rotateEventRoutineSecret(request, input)),
    listActivity: (input) => run(listEventActivity(request, input)),
  };
}
