import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentApproval, QueueSnapshot } from "@openbot/contracts/ipc";
import { isAgentWorking } from "../sidebar/sidebar-agent-states";

export interface AgentAvatarMoodsInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  failedTurns: Record<string, string | undefined>;
  pendingPrompts: Record<string, unknown | undefined>;
  pendingApprovals: Record<string, AgentApproval | undefined>;
  recentReplies: Record<string, boolean>;
}

/**
 * The face each agent wears, from the signals that can claim one.
 *
 * Pure and outside every context, for the same reason `computeSidebarAgentStates` is: the inputs
 * come from agents, turns and conversation at once, so a context that read all three would have to
 * sit under all three. It is the sibling of that function and shares its working test, so a row's
 * badge and the face above it can never disagree.
 *
 * The precedence is the point. It runs from the state that needs a person soonest to the state
 * that needs one least: a failed turn has already stopped, so it outranks a question that is still
 * waiting to be asked, which outranks work that is running on its own, which outranks a reply
 * nobody has read yet. Reading it the other way round would hide a failure behind the running turn
 * that produced it.
 *
 * An agent with nothing to say gets no entry, so the result is sparse and a missing key means
 * `idle` rather than "unknown". `connecting` and `asleep` are not derived here: they belong to the
 * surface around the avatar rather than to the agent, so their callers pass them in.
 */
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
