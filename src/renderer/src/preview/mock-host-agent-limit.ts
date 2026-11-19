import type { HostAdminDesktopApi } from "@openbot/contracts/ipc";
import { hostAgentLimitSettings } from "@openbot/contracts/ipc";

export function createMockHostAgentLimit(): Pick<HostAdminDesktopApi, "getAgentLimit" | "setAgentLimit"> {
  let limit: number | null = null;
  return {
    getAgentLimit: async () => hostAgentLimitSettings(limit),
    setAgentLimit: async (next) => {
      limit = next;
      return hostAgentLimitSettings(limit);
    },
  };
}
