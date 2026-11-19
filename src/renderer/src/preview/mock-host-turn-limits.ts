import {
  AGENT_TASK_LIMIT_DEFAULT,
  type HostAdminDesktopApi,
  type HostTurnLimits,
  type HostTurnLimitsInput,
  parseHostTurnLimitsInput,
} from "@openbot/contracts/ipc";

export function createMockHostTurnLimits(): Pick<HostAdminDesktopApi, "getTurnLimits" | "setTurnLimits"> {
  let limits: HostTurnLimitsInput = { turnLimit: null, agentTaskLimit: null };
  const snapshot = (): HostTurnLimits => ({
    ...limits,
    automaticTurnLimit: 8,
    defaultAgentTaskLimit: AGENT_TASK_LIMIT_DEFAULT,
  });
  return {
    getTurnLimits: async () => snapshot(),
    setTurnLimits: async (input) => {
      limits = parseHostTurnLimitsInput(input);
      return snapshot();
    },
  };
}
