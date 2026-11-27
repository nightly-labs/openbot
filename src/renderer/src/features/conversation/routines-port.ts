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
import { ROUTINES_SYNC_COLLECTION } from "@openbot/contracts/team-protocol/sync-collections";
import { parseSyncName } from "@openbot/contracts/team-protocol/sync-v1";
import type { EventRoutinesApi, RoutineWebhooksApi } from "./routine-webhooks-api";

interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
  runIn?: RoutineRunPlace;
  trigger?: EventRoutineTriggerInput;
}

export type RoutineEditorRecord = RoutineFields | EventRoutine;

interface RoutineSaveResult {
  routine: RoutineEditorRecord;
  secret: string | null;
}

interface RoutineResultsPort {
  options: () => Promise<RoutineResultConnectionOption[]>;
  destination: (routineId: string) => Promise<RoutineResultDestination | null>;
  setDestination: (
    routineId: string,
    destination: { connectionId: string; placeId: string; placeName: string } | null,
  ) => Promise<RoutineResultDestination | null>;
  deliveries?: (routineId: string) => Promise<RoutineResultDelivery[]>;
  resend?: (runId: string) => Promise<void>;
}

export interface RoutinesPort {
  ownerId: string;
  ownerNoun: "agent" | "channel";
  limitPolicy: boolean;
  missedPolicy: boolean;
  onceSchedule: boolean;
  runIn: boolean;
  list: () => Promise<RoutineEditorRecord[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineSaveResult>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
  events?: { owner: EventRoutineOwner; api: RoutineWebhooksApi };
  results?: RoutineResultsPort;
}

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

export type AgentRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  "listRoutines" | "listRoutineRuns" | "createRoutine" | "updateRoutine" | "deleteRoutine" | "testRoutine" | "onEvent"
> &
  Partial<Pick<OpenBotDesktopApi["agent"], "onSyncChanged">>;

export function agentRoutinesPort(
  agentId: string,
  runCommand?: (input: TestRoutineInput) => Promise<string>,
  localHost = false,
  api: AgentRoutinesApi = window.openbot.agent,
  runPlace = localHost,
  resultsServerId?: string | RoutineResultsCalls,
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
    subscribe: (reload) => {
      const stopEvents = api.onEvent((event) => {
        if (event.type === "routines-changed" && event.agentId === agentId) reload();
      });
      const stopSync = api.onSyncChanged?.((change) => {
        const synced = parseSyncName(change.name);
        if (synced?.base === ROUTINES_SYNC_COLLECTION.name && synced.param === agentId) reload();
      });
      return () => {
        stopEvents();
        stopSync?.();
      };
    },
  };
}

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
