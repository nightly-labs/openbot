import type { AgentProfile } from "../../data";

/** What the lock after an agent's name says. Empty for an agent with full access. */
export function agentAccessLockLabel(agent: Pick<AgentProfile, "access">): "Workspace only" | "" {
  return agent.access === "workspace" ? "Workspace only" : "";
}
