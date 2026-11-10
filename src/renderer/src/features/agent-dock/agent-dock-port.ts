import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the agent dock window and the main renderer reach in main for the dock. */
export interface AgentDockPort {
  agentDock: OpenBotDesktopApi["agentDock"];
}

/** Read on each call: stories replace `window.openbot` per case. */
export function agentDockPort(): AgentDockPort {
  return window.openbot;
}
