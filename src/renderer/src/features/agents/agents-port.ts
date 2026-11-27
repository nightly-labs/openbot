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
    | "getAgentBuiltinMemory"
    | "updateAgentBuiltinMemory"
    | "getAgentFastMode"
    | "updateAgentFastMode"
    | "listAgents"
    | "listConversationReads"
    | "listHiddenAgents"
    | "listAgentNotificationLevels"
    | "getSidebarLayout"
    | "getSidebarPins"
    | "listModels"
    | "onEvent"
    | "onSyncChanged"
    | "getRuntimeSnapshot"
    | "listPendingPrompts"
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
