import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

export interface AgentNotificationContent {
  title: string;
  body: string;
  silent?: boolean;
}

export function notificationForAgentEvent(
  event: AgentEvent,
  agents: AgentSummary[],
  translate: AppTranslate,
): AgentNotificationContent | null {
  if (event.type !== "turn-completed" && event.type !== "prompt" && event.type !== "approval") {
    return null;
  }

  const agentId = event.type === "approval" ? event.approval.agentId : event.agentId;
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent?.notifications) return null;

  if (event.type === "prompt") {
    return { title: agent.name, body: translate("notification.needsInput") };
  }
  if (event.type === "approval") {
    return { title: agent.name, body: translate("notification.needsApproval") };
  }
  if (event.status !== "completed") return null;
  return { title: agent.name, body: translate("notification.finished"), silent: true };
}
