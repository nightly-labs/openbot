import type { QueueSnapshot } from "@openbot/contracts/ipc";
import type { SidebarAgentState, SidebarRoutinePhase } from "./sidebar-types";

/** The turn a prompt or approval is blocked on. Only `turnId` matters to the badge. */
export type SidebarAttention =
  | { type: "prompt"; turnId: string }
  | { type: "browser-takeover-requested"; request: { turnId: string } };

export interface SidebarAgentStatesInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  unreadReplies: Record<string, number>;
  recentReplies: Record<string, boolean>;
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, { turnId: string } | undefined>;
  failedTurns: Record<string, string | undefined>;
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
 * The badge each agent shows in the sidebar.
 *
 * Pure, and outside every context, because the inputs come from different domains and a context
 * that read all of them would have to sit under all of them. The precedence is the point: a
 * routine mark outranks a generic working mark, and either outranks unread replies, because that
 * count is about to change again.
 *
 * One routine mark per agent. Several routine deliveries share it; `count` is how many are in the
 * phase the mark shows. A paused schedule is not a delivery, so it does not mark the row.
 *
 * An agent with nothing to say gets no entry at all, so the result is sparse and a missing key
 * means "idle" rather than "unknown".
 */
export function computeSidebarAgentStates(input: SidebarAgentStatesInput): Record<string, SidebarAgentState> {
  const states: Record<string, SidebarAgentState> = {};
  for (const agentId of input.agentIds) {
    const routine = routineBadge(agentId, input);
    if (routine) states[agentId] = routine;
    else if (isAgentWorking(agentId, input.activeTurns, input.queues)) states[agentId] = { kind: "working" };
    else if ((input.unreadReplies[agentId] ?? 0) > 0) {
      states[agentId] = { kind: "unread", count: input.unreadReplies[agentId] ?? 1 };
    } else if (input.recentReplies[agentId]) states[agentId] = { kind: "responded" };
  }
  return states;
}

function routineBadge(agentId: string, input: SidebarAgentStatesInput): SidebarAgentState | undefined {
  const deliveries = (input.queues[agentId]?.deliveries ?? []).filter((delivery) => delivery.sender.kind === "routine");
  if (deliveries.length === 0) return undefined;

  const running = deliveries.filter((delivery) => delivery.status === "starting" || delivery.status === "running");
  const attentionTurnId = blockedTurnId(input.pendingPrompts[agentId], input.pendingApprovals[agentId]);
  const blocked = running.filter((delivery) => delivery.turnId !== null && delivery.turnId === attentionTurnId);
  if (blocked.length > 0) return routineState("needs-attention", blocked.length);
  if (running.length > 0) return routineState("running", running.length);

  const failedTurnId = input.failedTurns[agentId];
  const failed = deliveries.filter((delivery) => delivery.status === "failed" && delivery.turnId === failedTurnId);
  if (failedTurnId && failed.length > 0) return routineState("failed", failed.length);

  const queued = deliveries.filter((delivery) => delivery.status === "queued");
  if (queued.length > 0) return routineState("queued", queued.length);
  return undefined;
}

function routineState(phase: SidebarRoutinePhase, count: number): SidebarAgentState {
  return { kind: "routine", phase, count };
}

function blockedTurnId(
  prompt: SidebarAttention | undefined,
  approval: { turnId: string } | undefined,
): string | undefined {
  if (prompt?.type === "prompt") return prompt.turnId;
  if (prompt?.type === "browser-takeover-requested") return prompt.request.turnId;
  return approval?.turnId;
}
