import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useConversation } from "../conversation/conversation-context";
import { attentionByAgent, keepEqualRecord } from "./agent-runtime-snapshot";
import { agentThreadAttention } from "./agent-thread-attention";
import { useAgents } from "./agents-context";

export function createAgentActivity() {
  const { agentList } = useAgents();
  const { activeTurns, subagentTurns, queues, failedTurns, usageLimits, pendingPrompts, pendingApprovals, approvals } =
    useTurns();
  const { unreadReplies, recentReplies } = useConversation();
  const agentTasks = useAgentTasks();

  const workingTurns = createMemo((previous?: Record<string, string | null>) => {
    const turns = { ...activeTurns() };
    const subagents = subagentTurns();
    for (const agent of agentList()) {
      const running = agentTasks.snapshot(agent.id)?.tasks.find((task) => task.state === "running");
      if (running && !turns[agent.id]) turns[agent.id] = running.activeTurnId ?? running.id;
      const subagentTurn = subagents[agent.id];
      if (subagentTurn && !turns[agent.id]) turns[agent.id] = subagentTurn;
    }
    return keepPrevious(previous, turns);
  });

  const agentStates = createMemo((previous?: Record<string, SidebarAgentState>) =>
    keepPrevious(
      previous,
      computeSidebarAgentStates({
        agentIds: agentList().map((agent) => agent.id),
        activeTurns: workingTurns(),
        queues: queues(),
        unreadReplies: unreadReplies(),
        unreadThreadReplies: agentTasks.unreadTotals(),
        recentReplies: recentReplies(),
        ...agentThreadAttention({ agents: agentList(), pendingPrompts: pendingPrompts(), approvals: approvals() }),
        failedTurns: failedTurns(),
        usageLimits: usageLimits(),
      }),
    ),
  );

  const agentMoods = createMemo((previous?: ReturnType<typeof computeAgentAvatarMoods>) =>
    keepPrevious(
      previous,
      computeAgentAvatarMoods({
        agentIds: agentList().map((agent) => agent.id),
        activeTurns: workingTurns(),
        queues: queues(),
        failedTurns: failedTurns(),
        pendingPrompts: attentionByAgent(pendingPrompts(), agentList()),
        pendingApprovals: pendingApprovals(),
        recentReplies: recentReplies(),
      }),
    ),
  );

  return { workingTurns, agentStates, agentMoods };
}

function keepPrevious<Value>(
  previous: Record<string, Value> | undefined,
  next: Record<string, Value>,
): Record<string, Value> {
  return previous ? keepEqualRecord(previous, next) : next;
}
