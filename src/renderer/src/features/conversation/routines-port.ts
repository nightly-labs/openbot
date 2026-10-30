// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type {
  OpenBotDesktopApi,
  RoutineFields,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineResultConnectionOption,
  RoutineResultDelivery,
  RoutineResultDestination,
  RoutineRunFields,
  RoutineSchedule,
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
  deliveries: (routineId: string) => Promise<RoutineResultDelivery[]>;
  resend: (runId: string) => Promise<void>;
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
   * Whether the host saves a one-time schedule. Only this computer's host does: the released Team
   * API cannot carry the `once` kind, so a remote host hides such routines.
   */
  onceSchedule: boolean;
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
  /** Only for an agent on this computer: the released Team API has no routine destinations. */
  results?: RoutineResultsPort;
}

function agentRoutineResults(agentId: string): RoutineResultsPort {
  const api = window.openbot.routineResults;
  return {
    options: () => api.options(),
    destination: (routineId) => api.destination({ agentId, routineId }),
    setDestination: (routineId, destination) => api.setDestination({ agentId, routineId, destination }),
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
  automation = false,
  localHost = false,
  api: AgentRoutinesApi = window.openbot.agent,
): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    limitPolicy: localHost,
    missedPolicy: localHost,
    onceSchedule: localHost,
    list: () => api.listRoutines(agentId),
    listRuns: (routineId, limit) => api.listRoutineRuns({ agentId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy, missedPolicy }) => {
      const policy = localHost
        ? { ...(limitPolicy ? { limitPolicy } : {}), ...(missedPolicy ? { missedPolicy } : {}) }
        : {};
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
    ...(automation
      ? { runCommand: (routineId: string) => window.openbot.agent.automationRunCommand({ agentId, routineId }) }
      : {}),
    ...(localHost ? { results: agentRoutineResults(agentId) } : {}),
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
): RoutinesPort {
  return {
    ownerId: channelId,
    ownerNoun: "channel",
    limitPolicy: localHost,
    missedPolicy: localHost,
    onceSchedule: localHost,
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
  legacy: Pick<RoutinesPort, "listRuns" | "subscribe" | "runCommand" | "missedPolicy" | "onceSchedule" | "results">,
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
    save: ({ routineId, name, instruction, active, timezone, schedule, trigger, limitPolicy, missedPolicy }) =>
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
      }),
    remove: (routineId) => api.deleteRoutine({ id: routineId, owner }),
    test: (routineId) => api.testRoutine({ id: routineId, owner }),
    ...(runCommand ? { runCommand } : {}),
    ...(results ? { results } : {}),
    subscribe: legacy.subscribe,
  };
}
