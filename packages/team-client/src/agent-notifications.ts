import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { AgentEvent, AgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";

export interface AgentNotificationContent {
  title: string;
  body: string;
  agentId: string;
  threadId: string | null;
}

/**
 * The one notice for a provider plan limit, at every level but "nothing". It is about the account,
 * so the switch of the agent whose turn found the limit does not silence it.
 */
export function notificationForUsageLimit(
  event: Extract<AgentEvent, { type: "usage-limit-reached" }>,
  agents: AgentSummary[],
  translate: AppTranslate,
  format: AppFormat,
  level: ServerNotificationLevel,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const count = event.agentCount;
  // A weekly window can reset days later, so a reset that is not today names its day.
  const resetDate = event.resetsAt === null ? null : new Date(event.resetsAt * 1_000);
  const reset =
    resetDate === null
      ? null
      : format.date(resetDate, {
          ...(resetDate.toDateString() === new Date().toDateString() ? {} : { weekday: "short" }),
          hour: "numeric",
          minute: "2-digit",
        });
  return {
    title: translate("notification.usageLimit.title", { provider: agentProviderName(event.provider) }),
    body: reset
      ? translate("notification.usageLimit.bodyResets", { count, reset })
      : translate("notification.usageLimit.body", { count }),
    agentId: event.agentId,
    threadId: agents.find((agent) => agent.id === event.agentId)?.threadId ?? null,
  };
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
