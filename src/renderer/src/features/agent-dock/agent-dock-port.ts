import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface AgentDockPort {
  agentDock: OpenBotDesktopApi["agentDock"];
  agent: Pick<OpenBotDesktopApi["agent"], "respondToBrowserSecret" | "openSharedFile" | "openWorkspaceFile">;
}

export function agentDockPort(): AgentDockPort {
  return window.openbot;
}
