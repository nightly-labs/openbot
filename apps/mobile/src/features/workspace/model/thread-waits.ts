import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import { type MobileAgentWaitReason, WAIT_RANK } from "./agent-activity";

/**
 * A question, approval or takeover that a side thread of an agent waits on. The agent's chat does not
 * show it (see `withoutTaskTurns`), but the home list marks the agent with it.
 */
export interface MobileThreadWait {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  reason: MobileAgentWaitReason;
}

/** True when `threadId` is the thread of a side thread of the agent that the phone knows. */
export type IsTaskThread = (agentId: string, threadId: string) => boolean;

function threadWait(
  request: { requestId: string | number; agentId: string; threadId: string; turnId: string },
  reason: MobileAgentWaitReason,
): MobileThreadWait {
  const { requestId, agentId, threadId, turnId } = request;
  return { requestId, agentId, threadId, turnId, reason };
}

function sameRequest(left: MobileThreadWait, right: { requestId: string | number; agentId: string }) {
  return left.agentId === right.agentId && String(left.requestId) === String(right.requestId);
}

function without(current: readonly MobileThreadWait[], drop: (wait: MobileThreadWait) => boolean) {
  const next = current.filter((wait) => !drop(wait));
  return next.length === current.length ? current : next;
}

/**
 * Folds one host event into the side-thread waits of one server. Only a request on a thread that
 * `isTaskThread` knows is a side-thread wait; the agent's chat keeps the others. A snapshot is the
 * current state, and a thread that no longer runs waits on nothing.
 */
export function reduceThreadWaits(
  current: readonly MobileThreadWait[],
  event: AgentEvent | TeamRealtimeEvent,
  isTaskThread: IsTaskThread,
): readonly MobileThreadWait[] {
  switch (event.type) {
    case "runtime-snapshot": {
      const { snapshot } = event;
      const waits = [
        ...snapshot.pendingApprovals.map((request) => threadWait(request, "approval")),
        ...snapshot.pendingBrowserTakeovers.map((request) => threadWait(request, "takeover")),
        ...snapshot.pendingPrompts.map((request) => threadWait(request, "question")),
      ].filter((wait) => isTaskThread(wait.agentId, wait.threadId));
      const next = reconcilePendingRequests(current, waits, snapshot.attentionComplete);
      return next.length === current.length && next.every((wait, index) => wait === current[index]) ? current : next;
    }
    case "prompt":
    case "approval":
    case "browser-takeover-requested": {
      const wait =
        event.type === "prompt"
          ? threadWait(event, "question")
          : event.type === "approval"
            ? threadWait(event.approval, "approval")
            : threadWait(event.request, "takeover");
      if (!isTaskThread(wait.agentId, wait.threadId)) return current;
      return [...current.filter((item) => !(sameRequest(item, wait) && item.reason === wait.reason)), wait];
    }
    case "agent-input-resolved": {
      const reason = event.kind === "approval" ? "approval" : "question";
      return without(current, (wait) => sameRequest(wait, event) && wait.reason === reason);
    }
    case "browser-takeover-resolved":
      return without(current, (wait) => sameRequest(wait, event) && wait.reason === "takeover");
    case "turn-completed":
      return without(current, (wait) => wait.agentId === event.agentId && wait.turnId === event.turnId);
    case "agent-tasks-changed": {
      const { agentId, tasks } = event.snapshot;
      const running = new Set(tasks.filter((task) => task.state === "running").map((task) => task.threadId));
      return without(current, (wait) => wait.agentId === agentId && !running.has(wait.threadId));
    }
    case "agents-changed": {
      const ids = new Set(event.agents.map((agent) => agent.id));
      return without(current, (wait) => !ids.has(wait.agentId));
    }
    default:
      return current;
  }
}

/** What the side threads of an agent wait on: the wait of the highest rank, as the agent's chat names it. */
export function agentThreadWaitReason(
  waits: readonly MobileThreadWait[],
  agentId: string,
): MobileAgentWaitReason | undefined {
  let reason: MobileAgentWaitReason | undefined;
  for (const wait of waits) {
    if (wait.agentId === agentId && (!reason || WAIT_RANK[wait.reason] > WAIT_RANK[reason])) reason = wait.reason;
  }
  return reason;
}
