// Access and auto-approve of one agent, as this computer holds them. The local IPC handlers and the
// `agent-admin-v1` host routes share this, so a remote admin changes the same state as the local
// window does, through the same writers.

import {
  type AgentAdminSettings,
  type AgentSummary,
  agentAutoApprovalEnabled,
  DEFAULT_AGENT_ACCESS,
  type UpdateAgentAdminSettingsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import type { ApprovalAutomation } from "./approval-automation-store";

export interface AgentAdminSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  approvalAutomation: Pick<ApprovalAutomation, "current" | "set">;
}

export interface AgentAdminSettingsService {
  read(agentId: string): AgentAdminSettings;
  update(input: UpdateAgentAdminSettingsInput): Promise<AgentAdminSettings>;
}

export class AgentNotFoundError extends Error {}

export function createAgentAdminSettings({
  agents,
  approvalAutomation,
}: AgentAdminSettingsDependencies): AgentAdminSettingsService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function settings(agent: AgentSummary): AgentAdminSettings {
    const preference = approvalAutomation.current();
    return {
      access: agent.access ?? DEFAULT_AGENT_ACCESS,
      autoApprove: agentAutoApprovalEnabled(preference, agent.id),
      autoApproveLocked: preference.turbo,
    };
  }
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    async update({ agentId, access, autoApprove }) {
      let agent = requireAgent(agentId);
      if (access !== undefined) agent = await agents.updateAgent({ agentId, access });
      if (autoApprove !== undefined) await approvalAutomation.set({ agentId, autoApprove });
      return settings(agent);
    },
  };
}
