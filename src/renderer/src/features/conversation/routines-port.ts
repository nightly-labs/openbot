// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type {
  EventRoutine,
  EventRoutineOwner,
  EventRoutineTriggerInput,
  EventSource,
  OpenBotDesktopApi,
  RoutineFields,
  RoutineLimitPolicy,
  RoutineRunFields,
  RoutineSchedule,
} from "@openbot/contracts/ipc";

import type { RoutineWebhooksApi } from "@openbot/ui/features/conversation/RoutineWebhookNotifications";
import { desktopEventsApi } from "./routine-webhooks-api";

interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  /** Left out, an update keeps the saved policy. */
  limitPolicy?: RoutineLimitPolicy;
  /** Event triggers are supported by the additive event API. Schedule-only adapters ignore this. */
  trigger?: EventRoutineTriggerInput;
}

export type RoutineEditorRecord = RoutineFields | EventRoutine;

export interface EventRoutinesApi {
  webhooks: RoutineWebhooksApi;
  listSources: () => Promise<EventSource[]>;
  listRoutines: (input: { owner: EventRoutineOwner }) => Promise<EventRoutine[]>;
  saveRoutine: (input: {
    id?: string;
    owner: EventRoutineOwner;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    trigger: EventRoutineTriggerInput;
    limitPolicy?: RoutineLimitPolicy;
  }) => Promise<EventRoutine>;
  deleteRoutine: (input: { id: string; owner: EventRoutineOwner }) => Promise<void>;
  testRoutine: (input: { id: string; owner: EventRoutineOwner }) => Promise<void>;
}

/** The desktop adapter for the server-scoped event routine group. */
export function desktopEventRoutinesApi(serverId: string): EventRoutinesApi {
  return {
    webhooks: desktopEventsApi(serverId),
    listSources: () => window.openbot.events.listSources(serverId),
    listRoutines: (input) => window.openbot.events.listRoutines(input, serverId),
    saveRoutine: (input) => window.openbot.events.saveRoutine(input, serverId),
    deleteRoutine: (input) => window.openbot.events.deleteRoutine(input, serverId),
    testRoutine: (input) => window.openbot.events.testRoutine(input, serverId),
  };
}

export interface RoutinesPort {
  ownerId: string;
  /** The word the editor reads in its placeholder: "Describe what this agent should do." */
  ownerNoun: "agent" | "channel";
  /**
   * Whether the host keeps what a routine does at a spent plan. Only this computer's host does: the
   * released Team API drops the field, so a remote host would ignore the choice.
   */
  limitPolicy: boolean;
  list: () => Promise<RoutineEditorRecord[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineEditorRecord>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  /** Only for an agent on this computer that allows local scripts. */
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
  /** Event source choices for a host with event support. */
  eventSources?: () => Promise<EventSource[]>;
  webhooks?: RoutineWebhooksApi;
}

export function agentRoutinesPort(agentId: string, automation = false, localHost = false): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    limitPolicy: localHost,
    list: () => window.openbot.agent.listRoutines(agentId),
    listRuns: (routineId, limit) => window.openbot.agent.listRoutineRuns({ agentId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy }) => {
      const policy = localHost && limitPolicy ? { limitPolicy } : {};
      return routineId
        ? window.openbot.agent.updateRoutine({ agentId, routineId, name, instruction, active, schedule, ...policy })
        : window.openbot.agent.createRoutine({ agentId, name, instruction, active, timezone, schedule, ...policy });
    },
    remove: (routineId) => window.openbot.agent.deleteRoutine({ agentId, routineId }),
    test: async (routineId) => {
      await window.openbot.agent.testRoutine({ agentId, routineId });
    },
    ...(automation
      ? { runCommand: (routineId: string) => window.openbot.agent.automationRunCommand({ agentId, routineId }) }
      : {}),
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
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
    list: () => api.listChannelRoutines(channelId),
    listRuns: (routineId, limit) => api.listChannelRoutineRuns({ channelId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy }) => {
      const policy = localHost && limitPolicy ? { limitPolicy } : {};
      return routineId
        ? api.updateChannelRoutine({ channelId, routineId, name, instruction, active, schedule, ...policy })
        : api.createChannelRoutine({ channelId, name, instruction, active, timezone, schedule, ...policy });
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
 * Creates a routine port backed by the additive event API.
 *
 * The event API carries routine records, while released schedule APIs still own run history and
 * change notifications. Callers can pass the legacy port so switching to this adapter does not
 * drop those views for schedule routines.
 */
export function eventRoutinesPort(
  owner: EventRoutineOwner,
  api: EventRoutinesApi,
  legacy: Pick<RoutinesPort, "listRuns" | "subscribe">,
): RoutinesPort {
  return {
    ownerId: owner.id,
    ownerNoun: owner.kind,
    limitPolicy: true,
    list: () => api.listRoutines({ owner }),
    listRuns: (routineId, limit) => legacy.listRuns(routineId, limit),
    eventSources: api.listSources,
    webhooks: api.webhooks,
    save: ({ routineId, name, instruction, active, timezone, schedule, trigger, limitPolicy }) =>
      api.saveRoutine({
        ...(routineId ? { id: routineId } : {}),
        owner,
        name,
        instruction,
        active,
        timezone,
        trigger: trigger ?? { kind: "schedule", schedule },
        ...(limitPolicy ? { limitPolicy } : {}),
      }),
    remove: (routineId) => api.deleteRoutine({ id: routineId, owner }),
    test: (routineId) => api.testRoutine({ id: routineId, owner }),
    subscribe: (reload) => legacy.subscribe(reload),
  };
}
