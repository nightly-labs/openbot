import type { QueueSnapshot } from "@openbot/contracts/ipc";
import type { SidebarAgentState } from "./sidebar-types";

export interface SidebarAgentStatesInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  unreadReplies: Record<string, number>;
  recentReplies: Record<string, boolean>;
}

/**
 * Whether an agent is running work right now.
 *
 * A channel turn belongs to another thread, so it reports no active turn and no running delivery
 * here. The queue's hold is the only signal that the agent doing that work is busy.
 *
 * Shared with the avatar's mood so a row's badge and its face can never disagree about who is
 * working - see `features/agents/agent-avatar-mood.ts`.
 */
export function isAgentWorking(
  agentId: string,
  activeTurns: Record<string, string | null>,
  queues: Record<string, QueueSnapshot>,
): boolean {
  const queue = queues[agentId];
  return (
    Boolean(activeTurns[agentId]) ||
    queue?.hold?.agentId === agentId ||
    Boolean(queue?.deliveries.some((delivery) => delivery.status === "starting" || delivery.status === "running"))
  );
}

/**
 * The badge each agent shows in the sidebar, from the four signals that can
 * claim one.
 *
 * Pure, and outside every context, because the inputs come from three different
 * domains - agents, turns and conversation - and a context that read all three
 * would have to sit under all three. The precedence is the point and is why this
 * is one function rather than three: an agent that is working shows *working*
 * even with unread replies waiting, because the count is about to change again.
 *
 * An agent with nothing to say gets no entry at all, so the result is sparse and
 * a missing key means "idle" rather than "unknown".
 */
export function computeSidebarAgentStates(input: SidebarAgentStatesInput): Record<string, SidebarAgentState> {
  const states: Record<string, SidebarAgentState> = {};
  for (const agentId of input.agentIds) {
    if (isAgentWorking(agentId, input.activeTurns, input.queues)) states[agentId] = { kind: "working" };
    else if ((input.unreadReplies[agentId] ?? 0) > 0) {
      states[agentId] = { kind: "unread", count: input.unreadReplies[agentId] ?? 1 };
    } else if (input.recentReplies[agentId]) states[agentId] = { kind: "responded" };
  }
  return states;
}
