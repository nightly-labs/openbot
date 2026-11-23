import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface UsagePort {
  agent: Pick<OpenBotDesktopApi["agent"], "getHostAnalytics" | "listAgents" | "onScopedEvent">;
  servers: Pick<OpenBotDesktopApi["servers"], "onEvent">;
}

export function usagePort(): UsagePort {
  return window.openbot;
}
