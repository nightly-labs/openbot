import type { AgentEvent, AgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

export interface AgentNotificationContent {
  title: string;
  body: string;
  agentId: string;
  threadId: string;
}

/**
 * What a server's agent event says to the user, or null when the server level or the agent's own
 * switch keeps it quiet. "needs-me" keeps only the events that wait for the user.
 */
export function notificationForAgentEvent(
  event: AgentEvent,
  agents: AgentSummary[],
  translate: AppTranslate,
  level: ServerNotificationLevel,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const subject = notificationSubject(event, level, translate);
  if (!subject) return null;
  const agent = agents.find((candidate) => candidate.id === subject.agentId);
  if (!agent?.notifications) return null;
  return { title: agent.name, ...subject };
}

function notificationSubject(
  event: AgentEvent,
  level: ServerNotificationLevel,
  translate: AppTranslate,
): Omit<AgentNotificationContent, "title"> | null {
  if (event.type === "prompt") {
    return { body: translate("notification.needsInput"), agentId: event.agentId, threadId: event.threadId };
  }
  if (event.type === "approval") {
    const { agentId, threadId } = event.approval;
    return { body: translate("notification.needsApproval"), agentId, threadId };
  }
  if (event.type !== "turn-completed" || level !== "all") return null;
  const { agentId, threadId } = event;
  if (event.status === "completed") return { body: translate("notification.finished"), agentId, threadId };
  // An interrupted turn is one the user stopped, so it is not news.
  if (event.status === "failed") return { body: translate("notification.failed"), agentId, threadId };
  return null;
}
