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
  /** The channel whose thread the event came from. A click opens the channel, not the agent chat. */
  channelId?: string;
}

/** The channel that owns the thread of an event, as the caller found it. */
export interface AgentNotificationChannel {
  id: string;
  name: string;
}

/**
 * The one notice for a provider plan limit, at every level but "nothing". It is about the account,
 * so the switch of the agent whose turn found the limit does not silence it.
 */
export function notificationForUsageLimit(
  event: Extract<AgentEvent, { type: "usage-limit-reached" }>,
  agents: ClientAgentSummary[],
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
 * The words of the agent that a notification may show. Without it, a notification shows only a
 * fixed text, so a shared screen or the Lock Screen shows no part of a conversation.
 */
export interface AgentNotificationPreview {
  /** The answer of the finished turn, as the agent wrote it, or null when the caller has none. */
  reply: string | null;
  /**
   * Hides the secrets in the text, because the Lock Screen can show it. The caller supplies it:
   * this package runs in a browser and in React Native, without the log redaction.
   */
  redact: (text: string) => string;
}

/** About three lines of a macOS notification. The system cuts a longer body itself. */
const PREVIEW_LIMIT = 200;
/**
 * The lead that a preview shows: the first sentences of a message, about two lines on a phone Lock
 * Screen. A notification is a glance, and the chat has the full message.
 */
const SUMMARY_LIMIT = 140;
/** The start of a reply that the preview reads, so that a long reply is not parsed in full. */
const REPLY_READ_LIMIT = 2_000;

/** A message or a routine run that the provider refused to start. No turn records the failure. */
const START_FAILED_CODE = "delivery_start_failed";

/**
 * The agent events that `notificationForAgentEvent` can show. Desktop, web and phone pass only these,
 * so each surface notifies about the same kinds.
 */
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

/**
 * The request that a notification waits for, or that an event resolves, so that an answer from any
 * device withdraws the notification. Null for an event that is not a request.
 */
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

/** Whether the event waits for the user, so that the "needs-me" level keeps it. */
export function agentEventNeedsUser(event: AgentEvent): boolean {
  return event.type === "prompt" || event.type === "approval" || event.type === "browser-takeover-requested";
}

/** The thread that an event waits on, or null when it is not a request. A channel can own that thread. */
export function agentEventRequestThread(event: AgentEvent): string | null {
  if (event.type === "prompt") return event.threadId;
  if (event.type === "approval") return event.approval.threadId;
  if (event.type === "browser-takeover-requested") return event.request.threadId;
  return null;
}

/** The agent of an event that can notify, or null for another event. */
export function agentEventAgentId(event: AgentEvent): string | null {
  switch (event.type) {
    case "prompt":
    case "turn-completed":
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

/**
 * The level for the events of one agent. The level that the user chose for the agent replaces the
 * server level, in both directions. A server set to "nothing" stays quiet for every agent: on a phone
 * it then has no registration that the host could send to, so the desktop and the web do the same.
 */
export function agentNotificationLevel(
  serverLevel: ServerNotificationLevel,
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null,
  agentId: string | null,
): ServerNotificationLevel {
  if (serverLevel === "nothing" || agentId === null) return serverLevel;
  return agentLevels?.get(agentId) ?? serverLevel;
}

/**
 * What a server's agent event says to the user, or null when the server level or the agent's own
 * switch keeps it quiet. "needs-me" keeps only the events that wait for the user. `channel` is the
 * channel that owns the thread of the event (see `agentEventRequestThread`): the title then names it.
 */
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
  // A start failure names no thread, so it opens the agent's own chat.
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
    // A command keeps its characters; a reason is Markdown, as a reply is.
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
  if (event.type === "error" && event.agentId && agentEventCanNotify(event))
    return { body: translate("notification.failed"), agentId: event.agentId, threadId: null };
  // A quiet routine run posted nothing, so there is nothing to look at. A turn that continues its
  // plan is not the end of the request.
  if (event.type !== "turn-completed" || event.quiet || event.continues) return null;
  const { agentId, threadId } = event;
  if (event.status === "completed") {
    // Redact before the cut and the Markdown change the shape of a secret.
    const reply = preview?.reply && plainPreview(preview.redact(preview.reply).slice(0, REPLY_READ_LIMIT));
    return { body: reply || translate("notification.finished"), agentId, threadId };
  }
  // An interrupted turn is one the user stopped, so it is not news.
  if (event.status === "failed") return { body: translate("notification.failed"), agentId, threadId };
  return null;
}

/** The lead of agent Markdown as plain text, cut to the preview length. */
export function plainPreview(text: string): string | null {
  return previewText(markdownPreviewText(messageSummary(text, SUMMARY_LIMIT)));
}

/** The text as one line, cut to the preview length, or null when nothing is left. */
function previewText(text: string): string | null {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  if (characters.length === 0) return null;
  if (characters.length <= PREVIEW_LIMIT) return characters.join("");
  return `${characters
    .slice(0, PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd()}…`;
}
