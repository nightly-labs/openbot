// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type {
  OpenBotDesktopApi,
  RoutineFields,
  RoutineLimitPolicy,
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
  /** Only the event API reads it. Schedule-only adapters save `schedule`. */
  trigger?: EventRoutineTriggerInput;
}

export type RoutineEditorRecord = RoutineFields | EventRoutine;

interface RoutineSaveResult {
  routine: RoutineEditorRecord;
  /** The webhook signing secret, set only when this save made a new webhook trigger. It is not shown again. */
  secret: string | null;
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
  save: (input: RoutineSaveInput) => Promise<RoutineSaveResult>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  /** Only for an agent on this computer that allows local scripts. */
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
  /** Webhook triggers and activity, for a host with event support. */
  events?: { owner: EventRoutineOwner; api: RoutineWebhooksApi };
}

export function agentRoutinesPort(agentId: string, automation = false, localHost = false): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    limitPolicy: localHost,
    list: () => window.openbot.agent.listRoutines(agentId),
    listRuns: (routineId, limit) => window.openbot.agent.listRoutineRuns({ agentId, routineId, limit }),
    save: async ({ routineId, name, instruction, active, timezone, schedule, limitPolicy }) => {
      const policy = localHost && limitPolicy ? { limitPolicy } : {};
      const routine = routineId
        ? await window.openbot.agent.updateRoutine({
            agentId,
            routineId,
            name,
            instruction,
            active,
            schedule,
            ...policy,
          })
        : await window.openbot.agent.createRoutine({
            agentId,
            name,
            instruction,
            active,
            timezone,
            schedule,
            ...policy,
          });
      return { routine, secret: null };
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
    save: async ({ routineId, name, instruction, active, timezone, schedule, limitPolicy }) => {
      const policy = localHost && limitPolicy ? { limitPolicy } : {};
      const routine = routineId
        ? await api.updateChannelRoutine({ channelId, routineId, name, instruction, active, schedule, ...policy })
        : await api.createChannelRoutine({ channelId, name, instruction, active, timezone, schedule, ...policy });
      return { routine, secret: null };
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
 * The event API carries routine records, while the released schedule APIs still own run history,
 * change notifications and the local run command. Callers pass the legacy port so that switching to
 * this adapter keeps those views.
 */
export function eventRoutinesPort(
  owner: EventRoutineOwner,
  api: EventRoutinesApi,
  legacy: Pick<RoutinesPort, "listRuns" | "subscribe" | "runCommand">,
): RoutinesPort {
  const runCommand = legacy.runCommand;
  return {
    ownerId: owner.id,
    ownerNoun: owner.kind,
    limitPolicy: true,
    list: () => api.listRoutines({ owner }),
    listRuns: (routineId, limit) => legacy.listRuns(routineId, limit),
    events: { owner, api },
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
    ...(runCommand ? { runCommand } : {}),
    subscribe: (reload) => legacy.subscribe(reload),
  };
}
