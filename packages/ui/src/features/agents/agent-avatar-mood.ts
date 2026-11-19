import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentApproval, QueueSnapshot } from "@openbot/contracts/ipc";
import { isAgentWorking } from "@openbot/ui/features/sidebar/sidebar-agent-states";

export interface AgentAvatarMoodsInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  failedTurns: Record<string, string | undefined>;
  pendingPrompts: Record<string, unknown | undefined>;
  pendingApprovals: Record<string, AgentApproval | undefined>;
  recentReplies: Record<string, boolean>;
}

export function computeAgentAvatarMoods(input: AgentAvatarMoodsInput): Record<string, AvatarMood> {
  const moods: Record<string, AvatarMood> = {};
  for (const agentId of input.agentIds) {
    if (input.failedTurns[agentId]) moods[agentId] = "failed";
    else if (input.pendingApprovals[agentId] || input.pendingPrompts[agentId]) moods[agentId] = "waiting";
    else if (isAgentWorking(agentId, input.activeTurns, input.queues)) moods[agentId] = "working";
    else if (input.recentReplies[agentId]) moods[agentId] = "responded";
  }
  return moods;
}
