// The routines twin of `memories-port.ts`: one settings panel, two owners.

import {
  LOCAL_SERVER_ID,
  type OpenBotDesktopApi,
  type RoutineFields,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineResultConnectionOption,
  type RoutineResultDelivery,
  type RoutineResultDestination,
  type RoutineResultRoutineInput,
  type RoutineRunFields,
  type RoutineRunPlace,
  type RoutineSchedule,
  type SetRoutineResultDestinationInput,
  type TestRoutineInput,
} from "@openbot/contracts/ipc";
import type { EventRoutine, EventRoutineOwner, EventRoutineTriggerInput } from "@openbot/contracts/ipc-events";
import type { EventRoutinesApi, RoutineWebhooksApi } from "./routine-webhooks-api";

interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  /** Left out, an update keeps the saved policy. */
  limitPolicy?: RoutineLimitPolicy;
  /** Left out, an update keeps the saved policy. */
  missedPolicy?: RoutineMissedPolicy;
  /** Left out, an update keeps the saved place. */
  runIn?: RoutineRunPlace;
  /** Only the event API reads it. Schedule-only adapters save `schedule`. */
  trigger?: EventRoutineTriggerInput;
}

export type RoutineEditorRecord = RoutineFields | EventRoutine;

interface RoutineSaveResult {
  routine: RoutineEditorRecord;
  /** The webhook signing secret, set only when this save made a new webhook trigger. It is not shown again. */
  secret: string | null;
}

/** The place an agent routine sends its answers to, and what became of each one. */
interface RoutineResultsPort {
  options: () => Promise<RoutineResultConnectionOption[]>;
  destination: (routineId: string) => Promise<RoutineResultDestination | null>;
  setDestination: (
    routineId: string,
    destination: { connectionId: string; placeId: string; placeName: string } | null,
  ) => Promise<RoutineResultDestination | null>;
  /** Only on this computer: `routine-results-v1` keeps the deliveries on the host's own computer. */
  deliveries?: (routineId: string) => Promise<RoutineResultDelivery[]>;
  resend?: (runId: string) => Promise<void>;
}

export interface RoutinesPort {
  ownerId: string;
  /** The word the editor reads in its placeholder: "Describe what this agent should do." */
  ownerNoun: "agent" | "channel";
  /**
   * Whether the host keeps what a routine does at a spent plan: this computer's host, and a remote
   * host through `events-v1`. The released schedule routes drop the field.
   */
  limitPolicy: boolean;
  /**
   * Whether the host keeps what a routine does with a run that came due while OpenBot was closed:
   * this computer's host, and a remote host with `routine-recovery-v1`. `events-v1` drops the field.
   */
  missedPolicy: boolean;
  /**
   * Whether the host saves a one-time schedule: this computer's host, and a remote host with
   * `routines-once-v1`. The released Team API cannot carry the `once` kind, so an older remote host
   * hides such routines.
   */
  onceSchedule: boolean;
  /**
   * Whether the host keeps where an agent routine runs: the agent's chat or the routine's own thread.
   * This computer's host does, and a remote host with `routine-run-place-v1`. The released routine
   * routes drop the field, so the remote adapters send it on that capability's routes.
   */
  runIn: boolean;
  list: () => Promise<RoutineEditorRecord[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineSaveResult>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  /** Only for an agent on this computer that allows local scripts. */
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
  /** Webhook triggers and activity, for a host with event support. */
  events?: { owner: EventRoutineOwner; api: RoutineWebhooksApi };
  /**
   * For an agent on this computer, or on a joined server whose host serves `routine-results-v1` to an
   * owner or admin. The released Team API has no routine destinations.
   */
  results?: RoutineResultsPort;
}

/** `serverId` names a joined server. Without it, the results are this computer's. */
/**
 * The `routine-results-v1` calls of a joined server, for a client without the desktop port. It has no
 * deliveries or second send: the contract keeps them on the host's own computer.
 */
export interface RoutineResultsCalls {
  options: () => Promise<RoutineResultConnectionOption[]>;
  destination: (input: RoutineResultRoutineInput) => Promise<RoutineResultDestination | null>;
  setDestination: (input: SetRoutineResultDestinationInput) => Promise<RoutineResultDestination | null>;
}

function agentRoutineResults(agentId: string, serverId?: string | RoutineResultsCalls): RoutineResultsPort {
  if (typeof serverId === "object")
    return {
      options: () => serverId.options(),
      destination: (routineId) => serverId.destination({ agentId, routineId }),
      setDestination: (routineId, destination) => serverId.setDestination({ agentId, routineId, destination }),
    };
  const api = window.openbot.routineResults;
  const server = serverId ?? LOCAL_SERVER_ID;
  const destinations: RoutineResultsPort = {
    options: () => api.options(server),
    destination: (routineId) => api.destination({ agentId, routineId }, server),
    setDestination: (routineId, destination) => api.setDestination({ agentId, routineId, destination }, server),
  };
  if (serverId) return destinations;
  return {
    ...destinations,
    deliveries: (routineId) => api.deliveries({ agentId, routineId }),
    resend: (runId) => api.resend({ agentId, runId }),
  };
}

/** The host calls an agent's routines make. The desktop sends them through preload. */
export type AgentRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  "listRoutines" | "listRoutineRuns" | "createRoutine" | "updateRoutine" | "deleteRoutine" | "testRoutine" | "onEvent"
>;

export function agentRoutinesPort(
  agentId: string,
  /**
   * Gives the command that runs a routine from a script on the host. Set only when the agent allows
   * Local scripts: on this computer, or for an owner or admin of a host with `routine-run-command-v1`.
   */
  runCommand?: (input: TestRoutineInput) => Promise<string>,
  localHost = false,
  api: AgentRoutinesApi = window.openbot.agent,
  runPlace = localHost,
  /**
   * A joined server whose host serves `routine-results-v1` to this owner or admin: its id on desktop,
   * or the calls of the web client.
   */
  resultsServerId?: string | RoutineResultsCalls,
  /** This computer's host, or a joined host with `routines-once-v1`. */
  onceSchedule = localHost,
): RoutinesPort {
  const results = localHost || resultsServerId ? agentRoutineResults(agentId, resultsServerId) : undefined;
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    limitPolicy: localHost,
    missedPolicy: localHost,
    onceSchedule,
    runIn: runPlace,
    list: () => api.listRoutines(agentId),
    listRuns: (routineId, limit) => api.listRoutineRuns({ agentId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy, missedPolicy, runIn }) => {
      const policy = {
        ...(localHost && limitPolicy ? { limitPolicy } : {}),
        ...(localHost && missedPolicy ? { missedPolicy } : {}),
        ...(runPlace && runIn ? { runIn } : {}),
      };
      return (
        routineId
          ? api.updateRoutine({ agentId, routineId, name, instruction, active, schedule, ...policy })
          : api.createRoutine({ agentId, name, instruction, active, timezone, schedule, ...policy })
      ).then((routine) => ({ routine, secret: null }));
    },
    remove: (routineId) => api.deleteRoutine({ agentId, routineId }),
    test: async (routineId) => {
      await api.testRoutine({ agentId, routineId });
    },
    ...(runCommand ? { runCommand: (routineId: string) => runCommand({ agentId, routineId }) } : {}),
    ...(results ? { results } : {}),
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "routines-changed" && event.agentId === agentId) reload();
      }),
  };
}

/** The host calls a channel's routines make. The desktop sends them through preload. */
export type ChannelRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listChannelRoutines"
  | "listChannelRoutineRuns"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "onEvent"
>;

export function channelRoutinesPort(
  channelId: string,
  api: ChannelRoutinesApi = window.openbot.agent,
  localHost = false,
  /** This computer's host, or a joined host with `routines-once-v1`. */
  onceSchedule = localHost,
): RoutinesPort {
  return {
    ownerId: channelId,
    ownerNoun: "channel",
    limitPolicy: localHost,
    missedPolicy: localHost,
    onceSchedule,
    runIn: false,
    list: () => api.listChannelRoutines(channelId),
    listRuns: (routineId, limit) => api.listChannelRoutineRuns({ channelId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy, missedPolicy }) => {
      const policy = localHost
        ? { ...(limitPolicy ? { limitPolicy } : {}), ...(missedPolicy ? { missedPolicy } : {}) }
        : {};
      return (
        routineId
          ? api.updateChannelRoutine({ channelId, routineId, name, instruction, active, schedule, ...policy })
          : api.createChannelRoutine({ channelId, name, instruction, active, timezone, schedule, ...policy })
      ).then((routine) => ({ routine, secret: null }));
    },
    remove: (routineId) => api.deleteChannelRoutine({ channelId, routineId }),
    test: async (routineId) => {
      await api.testChannelRoutine({ channelId, routineId });
    },
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "channel-routines-changed" && event.channelId === channelId) reload();
      }),
  };
}

/**
 * Creates a routine port backed by the event API.
 *
 * The event API carries routine records, while the released schedule APIs still own change
 * notifications, the local run command, and the run history of a host without `routine-recovery-v1`.
 * Callers pass the legacy port so that switching to this adapter keeps those views.
 */
export function eventRoutinesPort(
  owner: EventRoutineOwner,
  api: EventRoutinesApi,
  legacy: Pick<
    RoutinesPort,
    "listRuns" | "subscribe" | "runCommand" | "missedPolicy" | "onceSchedule" | "runIn" | "results"
  >,
): RoutinesPort {
  const { runCommand, results } = legacy;
  const recoveryRuns = api.listRuns;
  const missedPolicyKept = legacy.missedPolicy || recoveryRuns !== undefined;
  return {
    ownerId: owner.id,
    ownerNoun: owner.kind,
    limitPolicy: true,
    missedPolicy: missedPolicyKept,
    onceSchedule: legacy.onceSchedule,
    runIn: legacy.runIn,
    list: () => api.listRoutines({ owner }),
    // The released run routes leave out the records of missed occurrences.
    // An agent run names its agent so that the history opens the message the run posted.
    listRuns: recoveryRuns
      ? async (routineId, limit) => {
          const runs = await recoveryRuns({ owner, routineId, limit });
          return owner.kind === "agent"
            ? runs.map(({ deliveryId, ...run }) => ({ ...run, agentId: owner.id, deliveryId: deliveryId ?? null }))
            : runs;
        }
      : legacy.listRuns,
    events: { owner, api },
    save: ({ routineId, name, instruction, active, timezone, schedule, trigger, limitPolicy, missedPolicy, runIn }) =>
      api.saveRoutine({
        ...(routineId ? { id: routineId } : {}),
        owner,
        name,
        instruction,
        active,
        timezone,
        trigger: trigger ?? { kind: "schedule", schedule },
        ...(limitPolicy ? { limitPolicy } : {}),
        ...(missedPolicyKept && missedPolicy ? { missedPolicy } : {}),
        ...(legacy.runIn && runIn ? { runIn } : {}),
      }),
    remove: (routineId) => api.deleteRoutine({ id: routineId, owner }),
    test: (routineId) => api.testRoutine({ id: routineId, owner }),
    ...(runCommand ? { runCommand } : {}),
    ...(results ? { results } : {}),
    subscribe: legacy.subscribe,
  };
}
