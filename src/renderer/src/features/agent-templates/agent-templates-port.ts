import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface AgentTemplatesPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "addTemplateAgent" | "previewAgentTemplate" | "publishAgentTemplate" | "unpublishAgentTemplate"
  >;
  agentTemplates: Pick<OpenBotDesktopApi["agentTemplates"], "get" | "install" | "preview" | "publish" | "unpublish">;
}

export type AgentTemplatePublishCalls = Pick<AgentTemplatesPort["agentTemplates"], "preview" | "publish" | "unpublish">;

export interface AgentTemplateInstallCalls {
  agent: Pick<AgentTemplatesPort["agent"], "addTemplateAgent">;
  agentTemplates: Pick<AgentTemplatesPort["agentTemplates"], "get" | "install">;
}

export function agentTemplatesPort(): AgentTemplatesPort {
  return window.openbot;
}
