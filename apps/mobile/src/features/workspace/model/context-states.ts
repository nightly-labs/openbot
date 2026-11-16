import type { AgentContextState, AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";

/**
 * How full the context window of each agent chat and each side thread of a server is, from the last
 * `runtime-snapshot` (`context-usage-v1`). A host without the capability sends neither list, so its
 * chats show no context meter.
 */
export interface MobileContextStates {
  /** The agent's own chat, by agent id. */
  agents: Readonly<Record<string, AgentContextState>>;
  /** A side thread, by its thread id. */
  threads: Readonly<Record<string, AgentContextState>>;
}

export const NO_CONTEXT_STATES: MobileContextStates = { agents: {}, threads: {} };

/** Each snapshot replaces both lists. An equal snapshot keeps `current`, so no meter renders again. */
export function reduceContextStates(
  current: MobileContextStates,
  event: AgentEvent | TeamRealtimeEvent,
): MobileContextStates {
  if (event.type !== "runtime-snapshot") return current;
  const next: MobileContextStates = {
    agents: Object.fromEntries((event.snapshot.contextStates ?? []).map((state) => [state.agentId, state])),
    threads: Object.fromEntries((event.snapshot.threadContextStates ?? []).map((state) => [state.threadId, state])),
  };
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}
