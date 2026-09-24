import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the agents domain reaches in main: agent records, their models and read state, and the agent
 * event stream.
 */
export interface AgentsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "createAgent"
    | "deleteAgent"
    | "duplicateAgent"
    | "listConversationReads"
    | "listModels"
    | "onEvent"
    | "setAvatar"
    | "updateAgent"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function agentsPort(): AgentsPort {
  return window.openbot;
}
