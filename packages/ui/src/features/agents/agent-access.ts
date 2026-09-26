import { agentProviderName } from "@openbot/contracts/agent-providers";
import { enforcesWorkspaceAccess } from "@openbot/contracts/ipc";
import type { AgentProfile } from "../../data";

/** What the lock after an agent's name says. Empty for an agent with full access. */
export function agentAccessLockLabel(agent: Pick<AgentProfile, "access" | "provider">): string {
  if (agent.access !== "workspace") return "";
  return enforcesWorkspaceAccess(agent.provider)
    ? "Workspace only"
    : `Workspace only (not enforced for ${agentProviderName(agent.provider)})`;
}
