import { agentProviderName } from "@openbot/contracts/agent-providers";
import { enforcesWorkspaceAccess } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";

/** What the lock after an agent's name says. Empty for an agent with full access. */
export function agentAccessLockLabel(agent: Pick<AgentProfile, "access" | "provider">, t: AppTranslate): string {
  if (agent.access !== "workspace") return "";
  return enforcesWorkspaceAccess(agent.provider)
    ? t("agent.access.workspaceOnly")
    : t("agent.access.workspaceOnlyNotEnforced", { provider: agentProviderName(agent.provider) });
}
