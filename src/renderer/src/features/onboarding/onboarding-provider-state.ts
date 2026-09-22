import type { AgentProviderState, AgentStatus } from "@openbot/contracts/ipc";

/**
 * The provider state to show while `AgentStatus` carries no per-provider entry. Both onboarding
 * screens had their own copy, so a starting build could read as "checking" on one and "error" on
 * the other. Onboarding is the only reader, so it lives here and not beside the provider context.
 */
export function fallbackProviderState(status: AgentStatus): AgentProviderState {
  return status.phase === "starting" || status.phase === "restarting" ? "checking" : "error";
}
