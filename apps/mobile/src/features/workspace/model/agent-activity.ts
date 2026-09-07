import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";

export interface MobileAgentActivity {
  turnId: string | null;
  phase: "working" | "responding" | "waiting";
  detail: string | null;
}

export type MobileAgentActivities = Record<string, MobileAgentActivity>;

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
    for (const request of [
      ...event.snapshot.pendingPrompts,
      ...event.snapshot.pendingApprovals,
      ...event.snapshot.pendingBrowserTakeovers,
    ]) {
      next[request.agentId] = { turnId: request.turnId, phase: "waiting", detail: null };
    }
    return next;
  }
  if (event.type === "agents-changed") {
    const ids = new Set(event.agents.map((agent) => agent.id));
    return Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
  }
  if (event.type === "turn-started" || event.type === "turn-progress" || event.type === "conversation-delta") {
    const previous = current[event.agentId];
    return {
      ...current,
      [event.agentId]: {
        turnId: event.turnId,
        phase: event.type === "conversation-delta" ? "responding" : "working",
        detail:
          event.type === "turn-progress" ? event.detail : previous?.turnId === event.turnId ? previous.detail : null,
      },
    };
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
        message.status === "streaming" &&
        message.text.trim().length > 0,
    );
    return {
      ...current,
      [agentId]: {
        turnId: activeTurnId,
        phase: responding ? "responding" : previous?.turnId === activeTurnId ? previous.phase : "working",
        detail: previous?.turnId === activeTurnId ? previous.detail : null,
      },
    };
  }
  if (event.type === "turn-completed") {
    if (current[event.agentId]?.turnId !== event.turnId) return current;
    const next = { ...current };
    delete next[event.agentId];
    return next;
  }
  if (event.type === "prompt" || event.type === "approval" || event.type === "browser-takeover-requested") {
    const request = event.type === "approval" ? event.approval : event.type === "prompt" ? event : event.request;
    return { ...current, [request.agentId]: { turnId: request.turnId, phase: "waiting", detail: null } };
  }
  if (event.type === "agent-input-resolved" && current[event.agentId]) {
    return { ...current, [event.agentId]: { ...current[event.agentId], phase: "working", detail: null } };
  }
  return current;
}
