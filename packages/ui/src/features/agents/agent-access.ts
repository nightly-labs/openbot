import type { AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";

/** What the lock after an agent's name says. Empty for an agent with full access. */
export function agentAccessLockLabel(agent: Pick<AgentProfile, "access">, t: AppTranslate): string {
  return agent.access === "workspace" ? t("agent.access.workspaceOnly") : "";
}
