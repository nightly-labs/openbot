import type { AgentEvent, AgentPromptQuestion, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { type MobileAgentWaitReason, WAIT_RANK } from "./agent-activity";

export interface MobileThreadWait {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  reason: MobileAgentWaitReason;
  task: boolean;
  questions?: AgentPromptQuestion[];
}

export type IsTaskThread = (agentId: string, threadId: string) => boolean;

function threadWait(
  request: {
    requestId: string | number;
    agentId: string;
    threadId: string;
    turnId: string;
    questions?: AgentPromptQuestion[];
  },
  reason: MobileAgentWaitReason,
  isTaskThread: IsTaskThread,
): MobileThreadWait {
  const { requestId, agentId, threadId, turnId, questions } = request;
  return {
    requestId,
    agentId,
    threadId,
    turnId,
    reason,
    task: isTaskThread(agentId, threadId),
    ...(questions ? { questions } : {}),
  };
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
      return without(
        current,
        (wait) => wait.reason !== "question" && wait.agentId === event.agentId && wait.turnId === event.turnId,
      );
    case "agent-tasks-changed": {
      const { agentId, tasks } = event.snapshot;
      const states = new Map(tasks.map((task) => [task.threadId, task.state]));
      const next = current.flatMap((wait) => {
        if (wait.agentId !== agentId) return [wait];
        const state = states.get(wait.threadId);
        if (state === undefined) return wait.task ? [] : [wait];
        if (state !== "running" && (wait.reason !== "question" || state === "closed")) return [];
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

export function hostAwaitsQuestion(
  waits: readonly MobileThreadWait[],
  agentId: string,
  turnId: string | undefined,
  requestId: string | number,
): boolean {
  return waits.some(
    (wait) => wait.reason === "question" && wait.turnId === turnId && sameRequest(wait, { agentId, requestId }),
  );
}

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
