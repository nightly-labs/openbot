import type { AgentServerWorkPolicy } from "../src/backend/agent/server-work-policy";

/** Synthetic isolated scheduler capacity, never an application default or saved host override. */
export function defaultServerWorkPolicy() {
  return { enabled: true, maxConcurrentTasks: 50, maxUnfinishedTasks: 50, dispatchMode: "new-thread" as const };
}

export function serverWorkPolicyForAgent(
  policy: ReturnType<typeof defaultServerWorkPolicy>,
  _agentId: string,
): AgentServerWorkPolicy | null {
  return policy.enabled ? policy : null;
}
