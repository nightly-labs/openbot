// The routines twin of `memories-port.ts`: one settings panel, two owners.

import type { RoutineFields, RoutineRunFields, RoutineSchedule } from "@openbot/contracts/ipc";

export interface RoutineSaveInput {
  routineId: string | null;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
}

export interface RoutinesPort {
  ownerId: string;
  /** The word the editor reads in its placeholder: "Describe what this agent should do." */
  ownerNoun: "agent" | "channel";
  list: () => Promise<RoutineFields[]>;
  listRuns: (routineId: string, limit: number) => Promise<RoutineRunFields[]>;
  save: (input: RoutineSaveInput) => Promise<RoutineFields>;
  remove: (routineId: string) => Promise<void>;
  test: (routineId: string) => Promise<void>;
  subscribe: (reload: () => void) => () => void;
}

export function agentRoutinesPort(agentId: string): RoutinesPort {
  return {
    ownerId: agentId,
    ownerNoun: "agent",
    list: () => window.openbot.agent.listRoutines(agentId),
    listRuns: (routineId, limit) => window.openbot.agent.listRoutineRuns({ agentId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule }) =>
      routineId
        ? window.openbot.agent.updateRoutine({ agentId, routineId, name, instruction, active, schedule })
        : window.openbot.agent.createRoutine({ agentId, name, instruction, active, timezone, schedule }),
    remove: (routineId) => window.openbot.agent.deleteRoutine({ agentId, routineId }),
    test: async (routineId) => {
      await window.openbot.agent.testRoutine({ agentId, routineId });
    },
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "routines-changed" && event.agentId === agentId) reload();
      }),
  };
}

export function channelRoutinesPort(channelId: string): RoutinesPort {
  return {
    ownerId: channelId,
    ownerNoun: "channel",
    list: () => window.openbot.agent.listChannelRoutines(channelId),
    listRuns: (routineId, limit) => window.openbot.agent.listChannelRoutineRuns({ channelId, routineId, limit }),
    save: ({ routineId, name, instruction, active, timezone, schedule }) =>
      routineId
        ? window.openbot.agent.updateChannelRoutine({ channelId, routineId, name, instruction, active, schedule })
        : window.openbot.agent.createChannelRoutine({ channelId, name, instruction, active, timezone, schedule }),
    remove: (routineId) => window.openbot.agent.deleteChannelRoutine({ channelId, routineId }),
    test: async (routineId) => {
      await window.openbot.agent.testChannelRoutine({ channelId, routineId });
    },
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "channel-routines-changed" && event.channelId === channelId) reload();
      }),
  };
}
