// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type {
  OpenBotDesktopApi,
  RoutineFields,
  RoutineLimitPolicy,
  RoutineRunFields,
  RoutineSchedule,
} from "@openbot/contracts/ipc";

interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  /** Left out, an update keeps the saved policy. */
  limitPolicy?: RoutineLimitPolicy;
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
  list: () => Promise<RoutineFields[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineFields>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  /** Only for an agent on this computer that allows local scripts. */
  runCommand?: (routineId: string) => Promise<string>;
  subscribe: (reload: () => void) => () => void;
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
