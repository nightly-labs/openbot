import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useConversation } from "../conversation/conversation-context";
import { attentionByAgent } from "./agent-runtime-snapshot";
import { agentThreadAttention } from "./agent-thread-attention";
import { useAgents } from "./agents-context";

/**
 * What each agent of the active server does now: its working turn, the badge state that the sidebar
 * and the agent dock show, and the face of its avatar. Both surfaces read it, so they always agree.
 */
export function createAgentActivity() {
  const { agentList } = useAgents();
  const { activeTurns, subagentTurns, queues, failedTurns, usageLimits, pendingPrompts, pendingApprovals, approvals } =
    useTurns();
  const { unreadReplies, recentReplies } = useConversation();
  const agentTasks = useAgentTasks();

  /* The turn events of a side thread reach only its thread list, so an agent that works in a side
   * thread is found there. A subagent that runs on after its turn keeps its agent at work. */
  const workingTurns = createMemo(() => {
    const turns = { ...activeTurns() };
    const subagents = subagentTurns();
    for (const agent of agentList()) {
      const running = agentTasks.snapshot(agent.id)?.tasks.find((task) => task.state === "running");
      if (running && !turns[agent.id]) turns[agent.id] = running.activeTurnId ?? running.id;
      const subagentTurn = subagents[agent.id];
      if (subagentTurn && !turns[agent.id]) turns[agent.id] = subagentTurn;
    }
    return turns;
  });

  /* A routine that runs in its own thread is not in the agent's queue, so its thread names it. The
   * badge then shows the routine, not a reply that the user waits for (#7674). A reply to a message
   * sent in that thread keeps the working badge. */
  const runningRoutineThreads = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of agentList()) {
      const count = (agentTasks.snapshot(agent.id)?.tasks ?? []).filter(
        (task) => task.state === "running" && task.routineRunning === true,
      ).length;
      if (count > 0) counts[agent.id] = count;
    }
    return counts;
  });

  /* The agent conversation shows only the waits of the agent's own thread. A wait in a channel
   * thread stays out of "Needs you", because selecting the row cannot answer it. */
  const agentStates = createMemo(() =>
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
      runningRoutineThreads: runningRoutineThreads(),
    }),
  );

  /* The badge says what an agent is doing; the face says how it is going. `isAgentWorking` is
   * shared, and a routine mark only replaces the badge for that same agent. */
  const agentMoods = createMemo(() =>
    computeAgentAvatarMoods({
      agentIds: agentList().map((agent) => agent.id),
      activeTurns: workingTurns(),
      queues: queues(),
      failedTurns: failedTurns(),
      pendingPrompts: attentionByAgent(pendingPrompts(), agentList()),
      pendingApprovals: pendingApprovals(),
      recentReplies: recentReplies(),
    }),
  );

  return { workingTurns, agentStates, agentMoods };
}
