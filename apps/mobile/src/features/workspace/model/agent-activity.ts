import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";

/** What a waiting agent needs from the user, as the desktop sidebar names it. */
export type MobileAgentWaitReason = "question" | "approval" | "takeover";

export interface MobileAgentActivity {
  agentId?: string;
  turnId: string | null;
  phase: "working" | "responding" | "waiting";
  detail: string | null;
  /** Set only while `phase` is `waiting`. */
  reason?: MobileAgentWaitReason;
}

export type MobileAgentActivities = Record<string, MobileAgentActivity>;

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
          : { turnId: turn.turnId, phase: "working", detail: null };
    }
    for (const work of event.snapshot.work) {
      if (work.status === "failed") continue;
      next[work.agentId] ??= { turnId: work.turnId, phase: "working", detail: null };
    }
    // The later list wins, so a question names the wait over a takeover, and both over an approval.
    const waits = [
      ...event.snapshot.pendingApprovals.map((request) => ({ request, reason: "approval" as const })),
      ...event.snapshot.pendingBrowserTakeovers.map((request) => ({ request, reason: "takeover" as const })),
      ...event.snapshot.pendingPrompts.map((request) => ({ request, reason: "question" as const })),
    ];
    for (const { request, reason } of waits) {
      next[request.agentId] = { turnId: request.turnId, phase: "waiting", detail: null, reason };
    }
    return sameActivities(current, next) ? current : next;
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
        message.status === "streaming" &&
        message.text.trim().length > 0,
    );
    const kept = previous?.turnId === activeTurnId ? previous : undefined;
    return withActivity(current, agentId, {
      turnId: activeTurnId,
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
    const previous = current[request.agentId];
    const kept =
      previous?.phase === "waiting" && previous.turnId === request.turnId && previous.reason
        ? WAIT_RANK[previous.reason] > WAIT_RANK[reason]
          ? previous.reason
          : reason
        : reason;
    return withActivity(current, request.agentId, {
      turnId: request.turnId,
      phase: "waiting",
      detail: null,
      reason: kept,
    });
  }
  if (event.type === "agent-input-resolved") {
    const activity = current[event.agentId];
    if (activity) {
      return withActivity(current, event.agentId, {
        ...(activity.agentId ? { agentId: activity.agentId } : {}),
        turnId: activity.turnId,
        phase: "working",
        detail: null,
      });
    }
  }
  return current;
}
