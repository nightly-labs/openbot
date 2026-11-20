import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface AgentsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "createAgent"
    | "deleteAgent"
    | "duplicateAgent"
    | "getAgentAdminSettings"
    | "getAgentHostSettings"
    | "updateAgentHostSettings"
    | "getAgentBackupModels"
    | "updateAgentBackupModels"
    | "getAgentNewChat"
    | "updateAgentNewChat"
    | "getAgentPlanCard"
    | "updateAgentPlanCard"
    | "getAgentFastMode"
    | "updateAgentFastMode"
    | "listAgents"
    | "listConversationReads"
    | "listModels"
    | "onEvent"
    | "getRuntimeSnapshot"
    | "setAgentHidden"
    | "setAgentNotificationLevel"
    | "setAvatar"
    | "updateAgent"
    | "updateAgentAdminSettings"
  >;
  providerAdmin: Pick<OpenBotDesktopApi["providerAdmin"], "accounts" | "accountUsage">;
}

export function agentsPort(): AgentsPort {
  return window.openbot;
}
