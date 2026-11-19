import { agentProviderName } from "@openbot/contracts/agent-providers";
import type {
  AgentEvent,
  ClientAgentSummary,
  ServerNotificationLevel,
  TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { hideRedactionMarks, messageSummary } from "./message-summary";

export interface AgentNotificationContent {
  title: string;
  body: string;
  agentId: string;
  threadId: string | null;
  channelId?: string;
}

export interface AgentNotificationChannel {
  id: string;
  name: string;
}

export function notificationForUsageLimit(
  event: Extract<AgentEvent, { type: "usage-limit-reached" }>,
  agents: ClientAgentSummary[],
  translate: AppTranslate,
  format: AppFormat,
  level: ServerNotificationLevel,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const count = event.agentCount;
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

export interface AgentNotificationPreview {
  reply: string | null;
  redact: (text: string) => string;
}

const PREVIEW_LIMIT = 200;
const SUMMARY_LIMIT = 140;
const REPLY_READ_LIMIT = 2_000;

const START_FAILED_CODE = "delivery_start_failed";

export function agentEventCanNotify(event: AgentEvent | TeamRealtimeEvent): boolean {
  switch (event.type) {
    case "prompt":
    case "approval":
    case "browser-takeover-requested":
      return true;
    case "turn-completed":
      return event.status === "completed" || event.status === "failed";
    case "error":
      return event.code === START_FAILED_CODE && event.agentId !== undefined;
    default:
      return false;
  }
}

export function notificationRequestKey(serverId: string, event: AgentEvent): string | null {
  switch (event.type) {
    case "prompt":
      return `${serverId}:${event.agentId}:prompt:${event.requestId}`;
    case "approval":
      return `${serverId}:${event.approval.agentId}:approval:${event.approval.requestId}`;
    case "agent-input-resolved":
      return `${serverId}:${event.agentId}:${event.kind}:${event.requestId}`;
    case "browser-takeover-requested":
      return `${serverId}:${event.request.agentId}:browser:${event.request.requestId}`;
    case "browser-takeover-resolved":
      return `${serverId}:${event.agentId}:browser:${event.requestId}`;
    default:
      return null;
  }
}

export function teammateTurnCompleted(event: AgentEvent): boolean {
  return event.type === "turn-completed" && event.status === "completed" && event.origin === "agent";
}

export function agentEventNeedsUser(event: AgentEvent): boolean {
  return event.type === "prompt" || event.type === "approval" || event.type === "browser-takeover-requested";
}

export function agentEventRequestThread(event: AgentEvent): string | null {
  if (event.type === "prompt") return event.threadId;
  if (event.type === "approval") return event.approval.threadId;
  if (event.type === "browser-takeover-requested") return event.request.threadId;
  return null;
}

export function agentEventAgentId(event: AgentEvent): string | null {
  switch (event.type) {
    case "prompt":
    case "turn-completed":
    case "subagent-failed":
      return event.agentId;
    case "approval":
      return event.approval.agentId;
    case "browser-takeover-requested":
      return event.request.agentId;
    case "error":
      return event.agentId ?? null;
    default:
      return null;
  }
}

export function agentNotificationLevel(
  serverLevel: ServerNotificationLevel,
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null,
  agentId: string | null,
  hidden = false,
): ServerNotificationLevel {
  if (serverLevel === "nothing" || agentId === null) return serverLevel;
  const own = agentLevels?.get(agentId);
  if (own !== undefined) return own;
  return hidden && serverLevel === "all" ? "needs-me" : serverLevel;
}

export function notificationForAgentEvent(
  event: AgentEvent,
  agents: ClientAgentSummary[],
  translate: AppTranslate,
  level: ServerNotificationLevel,
  preview: AgentNotificationPreview | null = null,
  channel: AgentNotificationChannel | null = null,
): AgentNotificationContent | null {
  if (level === "nothing") return null;
  const subject = notificationSubject(event, level, translate, preview);
  if (!subject) return null;
  const agent = agents.find((candidate) => candidate.id === subject.agentId);
  if (!agent?.notifications) return null;
  if (channel)
    return {
      title: translate("notification.channelTitle", { agent: agent.name, channel: channel.name }),
      ...subject,
      channelId: channel.id,
    };
  return { title: agent.name, ...subject, threadId: subject.threadId ?? agent.threadId ?? null };
}

function notificationSubject(
  event: AgentEvent,
  level: ServerNotificationLevel,
  translate: AppTranslate,
  preview: AgentNotificationPreview | null,
): Omit<AgentNotificationContent, "title"> | null {
  if (event.type === "prompt") {
    const question = preview && event.questions[0]?.question;
    const body = (question && plainPreview(preview.redact(question))) || translate("notification.needsInput");
    return { body, agentId: event.agentId, threadId: event.threadId };
  }
  if (event.type === "approval") {
    const { agentId, threadId, kind, command, reason } = event.approval;
    const action = !preview
      ? null
      : kind === "command" && command
        ? previewText(hideRedactionMarks(preview.redact(command)))
        : reason && plainPreview(preview.redact(reason));
    const body = action
      ? translate("notification.needsApprovalFor", { action })
      : translate("notification.needsApproval");
    return { body, agentId, threadId };
  }
  if (event.type === "browser-takeover-requested") {
    const { agentId, threadId } = event.request;
    return { body: translate("notification.needsBrowserStep"), agentId, threadId };
  }
  if (level !== "all") return null;
  if (event.type === "subagent-failed") {
    const task = preview && plainPreview(preview.redact(event.title));
    const body = task
      ? translate("notification.subagentFailedFor", { task })
      : translate("notification.subagentFailed");
    return { body, agentId: event.agentId, threadId: event.threadId };
  }
  if (event.type === "error" && event.agentId && agentEventCanNotify(event))
    return { body: translate("notification.failed"), agentId: event.agentId, threadId: null };
  if (event.type !== "turn-completed" || event.quiet || event.continues) return null;
  const { agentId, threadId } = event;
  if (event.status === "completed") {
    const reply = preview?.reply && plainPreview(preview.redact(preview.reply).slice(0, REPLY_READ_LIMIT));
    return { body: reply || translate("notification.finished"), agentId, threadId };
  }
  if (event.status === "failed") return { body: translate("notification.failed"), agentId, threadId };
  return null;
}

export function plainPreview(text: string): string | null {
  return previewText(markdownPreviewText(messageSummary(text, SUMMARY_LIMIT)));
}

function previewText(text: string): string | null {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  if (characters.length === 0) return null;
  if (characters.length <= PREVIEW_LIMIT) return characters.join("");
  return `${characters
    .slice(0, PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd()}…`;
}
