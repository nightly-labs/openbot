import type { AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";

export function agentAccessLockLabel(agent: Pick<AgentProfile, "access">, t: AppTranslate): string {
  return agent.access === "workspace" ? t("agent.access.workspaceOnly") : "";
}
