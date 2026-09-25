import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the publish and install dialogs reach in main: the agent templates of this computer. */
export interface AgentTemplatesPort {
  agentTemplates: Pick<OpenBotDesktopApi["agentTemplates"], "get" | "install" | "preview" | "publish" | "unpublish">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function agentTemplatesPort(): AgentTemplatesPort {
  return window.openbot;
}
