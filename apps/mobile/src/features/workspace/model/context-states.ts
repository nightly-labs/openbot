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

/**
 * The states of `next`, with each one that equals its entry in `previous` kept as that entry, so a
 * chat whose context did not change does not render again. `previous` itself when nothing changed.
 */
function keptStates(
  previous: Readonly<Record<string, AgentContextState>>,
  next: readonly (readonly [string, AgentContextState])[],
): Readonly<Record<string, AgentContextState>> {
  let changed = next.length !== Object.keys(previous).length;
  const states: Record<string, AgentContextState> = {};
  for (const [key, state] of next) {
    const kept = previous[key];
    if (kept && JSON.stringify(kept) === JSON.stringify(state)) states[key] = kept;
    else {
      states[key] = state;
      changed = true;
    }
  }
  return changed ? states : previous;
}

/** Each snapshot replaces both lists. An equal snapshot keeps `current`, so no meter renders again. */
export function reduceContextStates(
  current: MobileContextStates,
  event: AgentEvent | TeamRealtimeEvent,
): MobileContextStates {
  if (event.type !== "runtime-snapshot") return current;
  const agents = keptStates(
    current.agents,
    (event.snapshot.contextStates ?? []).map((state) => [state.agentId, state] as const),
  );
  const threads = keptStates(
    current.threads,
    (event.snapshot.threadContextStates ?? []).map((state) => [state.threadId, state] as const),
  );
  return agents === current.agents && threads === current.threads ? current : { agents, threads };
}
