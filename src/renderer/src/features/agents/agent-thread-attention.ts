import type { AgentApproval } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { SidebarApproval, SidebarAttention } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { attentionAgentId, type PendingAttentionPrompts } from "./agent-runtime-snapshot";

export interface AgentThreadAttentionInput {
  agents: readonly Pick<AgentProfile, "id" | "threadId">[];
  /** By `attentionKey`. */
  pendingPrompts: PendingAttentionPrompts;
  approvals: readonly AgentApproval[];
}

/**
 * The prompts and approvals of each agent's own thread, by agent. A wait in a channel or side
 * thread stays out, because the agent's chat cannot answer it.
 */
export function agentThreadAttention(input: AgentThreadAttentionInput): {
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, SidebarApproval | undefined>;
} {
  const agentThreads = new Map(input.agents.map((agent) => [agent.id, agent.threadId]));
  const inAgentThread = (agentId: string, threadId: string | undefined) =>
    threadId !== undefined && agentThreads.get(agentId) === threadId;
  return {
    pendingPrompts: Object.fromEntries(
      Object.values(input.pendingPrompts).flatMap((event) =>
        event &&
        inAgentThread(attentionAgentId(event), event.type === "prompt" ? event.threadId : event.request.threadId)
          ? [[attentionAgentId(event), event] as const]
          : [],
      ),
    ),
    pendingApprovals: Object.fromEntries(
      input.approvals
        .filter((approval) => inAgentThread(approval.agentId, approval.threadId))
        .map((approval) => [approval.agentId, approval]),
    ),
  };
}
