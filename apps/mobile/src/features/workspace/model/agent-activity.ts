import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";

/** What a waiting agent needs from the user, as the desktop sidebar names it. */
export type MobileAgentWaitReason = "question" | "approval" | "takeover";

/** What stops an agent until the user acts, with the question or the command when the host sent one. */
export interface MobileAgentWait {
  reason: MobileAgentWaitReason;
  detail: string | null;
}

export interface MobileAgentActivity {
  agentId?: string;
  turnId: string | null;
  /**
   * The thread of the turn, when an event named it. A turn on another thread than the agent's own,
   * such as the work of a channel, is not the work of its chat.
   */
  threadId?: string;
  phase: "working" | "responding" | "waiting";
  /** What the agent does now. While it waits, the question or the command that it waits on. */
  detail: string | null;
  /** Set only while `phase` is `waiting`. */
  reason?: MobileAgentWaitReason;
}

export type MobileAgentActivities = Record<string, MobileAgentActivity>;

/**
 * The live activity, unless the conversation already shows its turn as finished. Turn events and
 * conversation reads arrive by separate channels, so `turn-started` can arrive after the read that
 * holds the finished reply. A turn with messages that is not the active turn has ended.
 */
export function openTurnActivity(
  activity: MobileAgentActivity | undefined,
  conversation: { activeTurnId: string | null; messages: readonly { turnId?: string | null }[] } | undefined,
): MobileAgentActivity | undefined {
  const turnId = activity?.turnId;
  if (!turnId || !conversation || conversation.activeTurnId === turnId) return activity;
  return conversation.messages.some((message) => message.turnId === turnId) ? undefined : activity;
}

/**
 * The face an avatar wears for an activity. An agent that waits on an answer holds its resting
 * face and stops moving; anything else it does is work. The mood table itself is shared with the
 * desktop, so the two cannot drift.
 */
export function agentActivityMood(activity: MobileAgentActivity | undefined): AvatarMood {
  if (!activity) return "idle";
  return activity.phase === "waiting" ? "waiting" : "working";
}

/** When two requests wait in one turn, the higher rank names the wait, as on the desktop. */
const WAIT_RANK = { approval: 0, takeover: 1, question: 2 } as const satisfies Record<MobileAgentWaitReason, number>;

function sameActivity(left: MobileAgentActivity | undefined, right: MobileAgentActivity) {
  return (
    left !== undefined &&
    left.agentId === right.agentId &&
    left.turnId === right.turnId &&
    left.threadId === right.threadId &&
    left.phase === right.phase &&
    left.detail === right.detail &&
    left.reason === right.reason
  );
}

/** Keep `current` when an event does not change what an agent shows, so consumers are not notified. */
function withActivity(current: MobileAgentActivities, agentId: string, activity: MobileAgentActivity) {
  return sameActivity(current[agentId], activity) ? current : { ...current, [agentId]: activity };
}

function sameActivities(left: MobileAgentActivities, right: MobileAgentActivities) {
  const keys = Object.keys(right);
  return (
    keys.length === Object.keys(left).length &&
    keys.every((key) => {
      const activity = right[key];
      return activity !== undefined && (left[key] === activity || sameActivity(left[key], activity));
    })
  );
}

export function reduceAgentActivity(
  current: MobileAgentActivities,
  event: AgentEvent | TeamRealtimeEvent,
): MobileAgentActivities {
  if (event.type === "runtime-snapshot") {
    const next: MobileAgentActivities = {};
    for (const turn of event.snapshot.activeTurns) {
      const previous = current[turn.agentId];
      next[turn.agentId] =
        previous?.turnId === turn.turnId && previous.phase !== "waiting"
          ? previous
          : { turnId: turn.turnId, threadId: turn.threadId, phase: "working", detail: null };
    }
    for (const work of event.snapshot.work) {
      if (work.status === "failed") continue;
      next[work.agentId] ??= { turnId: work.turnId, phase: "working", detail: null };
    }
    // The later list wins, so a question names the wait over a takeover, and both over an approval.
    const waits = [
      ...event.snapshot.pendingApprovals.map((request) => ({
        request,
        reason: "approval" as const,
        detail: approvalDetail(request),
      })),
      ...event.snapshot.pendingBrowserTakeovers.map((request) => ({
        request,
        reason: "takeover" as const,
        detail: null,
      })),
      ...event.snapshot.pendingPrompts.map((request) => ({
        request,
        reason: "question" as const,
        detail: questionDetail(request.questions),
      })),
    ];
    for (const { request, reason, detail } of waits) {
      next[request.agentId] = {
        turnId: request.turnId,
        threadId: request.threadId,
        phase: "waiting",
        detail,
        reason,
      };
    }
    return sameActivities(current, next) ? current : next;
  }
  if (event.type === "agent-tasks-changed") {
    // A turn that started before the phone knew its task belongs to the task, not to the chat.
    const { agentId, tasks } = event.snapshot;
    const activity = current[agentId];
    if (!activity?.turnId || !tasks.some((task) => task.activeTurnId === activity.turnId)) return current;
    const next = { ...current };
    delete next[agentId];
    return next;
  }
  if (event.type === "agents-changed") {
    const ids = new Set(event.agents.map((agent) => agent.id));
    if (Object.keys(current).every((id) => ids.has(id))) return current;
    return Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
  }
  if (event.type === "turn-started" || event.type === "turn-progress" || event.type === "conversation-delta") {
    const previous = current[event.agentId];
    if (event.type === "conversation-delta" && previous?.turnId === event.turnId && previous.phase === "responding")
      return current;
    return withActivity(current, event.agentId, {
      turnId: event.turnId,
      threadId: event.threadId,
      phase: event.type === "conversation-delta" ? "responding" : "working",
      detail:
        event.type === "turn-progress" ? event.detail : previous?.turnId === event.turnId ? previous.detail : null,
    });
  }
  if (event.type === "conversation") {
    const { agentId, activeTurnId, messages } = event.snapshot;
    if (!activeTurnId) {
      if (!current[agentId]) return current;
      const next = { ...current };
      delete next[agentId];
      return next;
    }
    const previous = current[agentId];
    const responding = messages.some(
      (message) =>
        message.turnId === activeTurnId &&
        message.author === "assistant" &&
        message.itemType !== "commentary" &&
        message.itemType !== "plan" &&
        message.itemType !== "subagents" &&
        message.status === "streaming" &&
        message.text.trim().length > 0,
    );
    const kept = previous?.turnId === activeTurnId ? previous : undefined;
    const threadId = event.snapshot.threadId ?? kept?.threadId;
    return withActivity(current, agentId, {
      turnId: activeTurnId,
      ...(threadId ? { threadId } : {}),
      phase: responding ? "responding" : (kept?.phase ?? "working"),
      detail: kept?.detail ?? null,
      ...(!responding && kept?.reason ? { reason: kept.reason } : {}),
    });
  }
  if (event.type === "turn-completed") {
    if (current[event.agentId]?.turnId !== event.turnId) return current;
    const next = { ...current };
    delete next[event.agentId];
    return next;
  }
  if (event.type === "prompt" || event.type === "approval" || event.type === "browser-takeover-requested") {
    const request = event.type === "approval" ? event.approval : event.type === "prompt" ? event : event.request;
    const reason = event.type === "approval" ? "approval" : event.type === "prompt" ? "question" : "takeover";
    const detail =
      event.type === "approval"
        ? approvalDetail(event.approval)
        : event.type === "prompt"
          ? questionDetail(event.questions)
          : null;
    const previous = current[request.agentId];
    // The wait of the higher rank keeps its detail with its reason.
    const kept: MobileAgentWait =
      previous?.phase === "waiting" &&
      previous.turnId === request.turnId &&
      previous.reason &&
      WAIT_RANK[previous.reason] > WAIT_RANK[reason]
        ? { reason: previous.reason, detail: previous.detail }
        : { reason, detail };
    return withActivity(current, request.agentId, {
      turnId: request.turnId,
      threadId: request.threadId,
      phase: "waiting",
      detail: kept.detail,
      reason: kept.reason,
    });
  }
  if (event.type === "agent-input-resolved") {
    const activity = current[event.agentId];
    if (activity) {
      return withActivity(current, event.agentId, {
        ...(activity.agentId ? { agentId: activity.agentId } : {}),
        turnId: activity.turnId,
        ...(activity.threadId ? { threadId: activity.threadId } : {}),
        phase: "working",
        detail: null,
      });
    }
  }
  return current;
}

/** The first question of a prompt, as the desktop sidebar shows it. */
function questionDetail(questions: readonly { question: string }[]): string | null {
  return questions[0]?.question.trim() || null;
}

/** The command of an approval, else its reason. */
function approvalDetail(approval: { command: string | null; reason: string | null }): string | null {
  return approval.command?.trim() || approval.reason?.trim() || null;
}
