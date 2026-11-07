import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { type MobileAgentWaitReason, WAIT_RANK } from "./agent-activity";

/**
 * A question, approval or takeover that an agent waits on. `task` is true when it is on a side thread
 * that the phone knows: the agent's chat does not show it (see `withoutTaskTurns`), but the home list
 * marks the agent with it. A request on a thread that is not known yet stays, so that it becomes a
 * side-thread wait when the agent's task list arrives.
 */
export interface MobileThreadWait {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  reason: MobileAgentWaitReason;
  task: boolean;
}

/** True when `threadId` is the thread of a side thread of the agent that the phone knows. */
export type IsTaskThread = (agentId: string, threadId: string) => boolean;

function threadWait(
  request: { requestId: string | number; agentId: string; threadId: string; turnId: string },
  reason: MobileAgentWaitReason,
  isTaskThread: IsTaskThread,
): MobileThreadWait {
  const { requestId, agentId, threadId, turnId } = request;
  return { requestId, agentId, threadId, turnId, reason, task: isTaskThread(agentId, threadId) };
}

function sameRequest(left: MobileThreadWait, right: { requestId: string | number; agentId: string }) {
  return left.agentId === right.agentId && String(left.requestId) === String(right.requestId);
}

function sameWait(left: MobileThreadWait, right: MobileThreadWait | undefined) {
  return (
    right !== undefined &&
    sameRequest(left, right) &&
    left.reason === right.reason &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.task === right.task
  );
}

function without(current: readonly MobileThreadWait[], drop: (wait: MobileThreadWait) => boolean) {
  const next = current.filter((wait) => !drop(wait));
  return next.length === current.length ? current : next;
}

/**
 * Folds one host event into the pending requests of one server. Only a request on a thread that
 * `isTaskThread` knows is a side-thread wait; the agent's chat shows the others. A snapshot is the
 * current state, a task list marks the requests of its running threads, and a thread that no longer
 * runs waits on nothing.
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
        ...snapshot.pendingApprovals.map((request) => threadWait(request, "approval", isTaskThread)),
        ...snapshot.pendingBrowserTakeovers.map((request) => threadWait(request, "takeover", isTaskThread)),
        ...snapshot.pendingPrompts.map((request) => threadWait(request, "question", isTaskThread)),
      ];
      // A partial snapshot is whole for each agent that it names.
      const named = new Set(waits.map((wait) => wait.agentId));
      const next = snapshot.attentionComplete
        ? waits
        : [...current.filter((wait) => !named.has(wait.agentId)), ...waits];
      return next.length === current.length && next.every((wait, index) => sameWait(wait, current[index]))
        ? current
        : next;
    }
    case "prompt":
    case "approval":
    case "browser-takeover-requested": {
      const wait =
        event.type === "prompt"
          ? threadWait(event, "question", isTaskThread)
          : event.type === "approval"
            ? threadWait(event.approval, "approval", isTaskThread)
            : threadWait(event.request, "takeover", isTaskThread);
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
      const threads = new Map(tasks.map((task) => [task.threadId, task.state === "running"]));
      const next = current.flatMap((wait) => {
        if (wait.agentId !== agentId) return [wait];
        const running = threads.get(wait.threadId);
        // A request on a thread that is not a task is a wait of the agent's chat; it stays.
        if (running === undefined) return wait.task ? [] : [wait];
        if (!running) return [];
        return [wait.task ? wait : { ...wait, task: true }];
      });
      return next.length === current.length && next.every((wait, index) => wait === current[index]) ? current : next;
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
    if (wait.task && wait.agentId === agentId && (!reason || WAIT_RANK[wait.reason] > WAIT_RANK[reason]))
      reason = wait.reason;
  }
  return reason;
}
