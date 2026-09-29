import type { QueueSnapshot } from "@openbot/contracts/ipc";
import type { SidebarAgentState, SidebarRoutinePhase } from "./sidebar-types";

/** A question or a browser takeover that an agent is blocked on. */
export type SidebarAttention =
  | { type: "prompt"; turnId: string; questions?: readonly { question: string }[] }
  | { type: "browser-takeover-requested"; request: { turnId: string } };

/** An approval that an agent is blocked on. The command or the reason is the tooltip detail. */
export interface SidebarApproval {
  turnId: string;
  command?: string | null;
  reason?: string | null;
}

export interface SidebarAgentStatesInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  unreadReplies: Record<string, number>;
  recentReplies: Record<string, boolean>;
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, SidebarApproval | undefined>;
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
 * that read all of them would have to sit under all of them. The precedence is the point: an agent
 * that waits for the user outranks everything, because nothing moves until the user acts. A routine
 * mark outranks a generic working mark, and either outranks unread replies, because that count is
 * about to change again.
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
    const marked =
      waitingState(input.pendingPrompts[agentId], input.pendingApprovals[agentId]) ?? routineBadge(agentId, input);
    if (marked) states[agentId] = marked;
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

/** When a prompt and an approval are both pending, the prompt names the wait. */
function waitingState(
  prompt: SidebarAttention | undefined,
  approval: SidebarApproval | undefined,
): SidebarAgentState | undefined {
  if (prompt?.type === "prompt") {
    return { kind: "waiting", reason: "question", detail: prompt.questions?.[0]?.question.trim() || null };
  }
  if (prompt?.type === "browser-takeover-requested") return { kind: "waiting", reason: "takeover", detail: null };
  if (approval) {
    return { kind: "waiting", reason: "approval", detail: approval.command?.trim() || approval.reason?.trim() || null };
  }
  return undefined;
}
