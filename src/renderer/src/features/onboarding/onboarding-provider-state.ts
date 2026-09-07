import type { AgentProviderState, AgentStatus } from "@openbot/contracts/ipc";

/**
 * The provider state to show while `AgentStatus` carries no per-provider entry.
 *
 * Both onboarding screens ask this, and both had their own copy, so a build that is
 * still starting could read as "checking" on one screen and "error" on the other.
 * Onboarding is the only reader, which is why it lives here rather than beside the
 * provider context.
 */
export function fallbackProviderState(status: AgentStatus): AgentProviderState {
  return status.phase === "starting" || status.phase === "restarting" ? "checking" : "error";
}
