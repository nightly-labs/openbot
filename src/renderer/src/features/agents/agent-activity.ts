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

/**
 * What each agent of the active server does now: its working turn, the badge state that the sidebar
 * and the agent dock show, and the face of its avatar. Both surfaces read it, so they always agree.
 */
export function createAgentActivity() {
  const { agentList } = useAgents();
  const {
    activeTurns,
    subagentTurns,
    queues,
    failedTurns,
    interruptedTurns,
    usageLimits,
    pendingPrompts,
    pendingApprovals,
    approvals,
  } = useTurns();
  const { unreadReplies, recentReplies } = useConversation();
  const agentTasks = useAgentTasks();

  /* The turn events of a side thread reach only its thread list, so an agent that works in a side
   * thread is found there. A subagent that runs on after its turn keeps its agent at work. */
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

  /* The agent conversation shows only the waits of the agent's own thread. A wait in a channel
   * thread stays out of "Needs you", because selecting the row cannot answer it. A state that did not
   * change keeps its object, so a progress event of one agent does not run the rows of all agents. */
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
        interruptedTurns: interruptedTurns(),
        usageLimits: usageLimits(),
      }),
    ),
  );

  /* The badge says what an agent is doing; the face says how it is going. `isAgentWorking` is
   * shared, and a routine mark only replaces the badge for that same agent. */
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

/** The previous record when no entry changed. The first run has none. */
function keepPrevious<Value>(
  previous: Record<string, Value> | undefined,
  next: Record<string, Value>,
): Record<string, Value> {
  return previous ? keepEqualRecord(previous, next) : next;
}
