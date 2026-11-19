import type { AgentContextState, AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";

export interface MobileContextStates {
  agents: Readonly<Record<string, AgentContextState>>;
  threads: Readonly<Record<string, AgentContextState>>;
}

export const NO_CONTEXT_STATES: MobileContextStates = { agents: {}, threads: {} };

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
