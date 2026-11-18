import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the agent dock window and the main renderer reach in main for the dock. The dock window sends
 * a password or a code itself, so the secret does not pass through the main renderer.
 */
export interface AgentDockPort {
  agentDock: OpenBotDesktopApi["agentDock"];
  agent: Pick<OpenBotDesktopApi["agent"], "respondToBrowserSecret">;
}

/** Read on each call: stories replace `window.openbot` per case. */
export function agentDockPort(): AgentDockPort {
  return window.openbot;
}
