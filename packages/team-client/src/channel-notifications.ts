import type {
  ChannelPreview,
  ChannelSummary,
  ClientAgentSummary,
  ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type AgentNotificationChannel, plainPreview } from "./agent-notifications";

export interface ChannelNotificationContent {
  title: string;
  body: string;
  channelId: string;
  agentId: string;
}

export interface ChannelNotificationOptions {
  agents: readonly ClientAgentSummary[];
  translate: AppTranslate;
  level: ServerNotificationLevel;
  /** Hides the secrets in the preview. Null when the user keeps the agent's words out of notifications. */
  redact: ((text: string) => string) | null;
}

type SettledReply = ChannelPreview & { author: { kind: "agent"; id: string } };

/**
 * The newest message of a channel when it is an agent reply and the work of the channel has ended:
 * the message stopped streaming and no task is queued, waits or runs. A turn can write many messages,
 * ask a question on the way, or pass work to other agents, so only the end of the work is a reply to
 * tell.
 */
function settledReply(channel: ChannelSummary): SettledReply | null {
  const last = channel.lastMessage;
  if ((channel.openTasks ?? channel.activeTasks) > 0 || last?.author?.kind !== "agent") return null;
  if (last.status !== "completed" && last.status !== "failed") return null;
  return { ...last, author: { kind: "agent", id: last.author.id } };
}

/**
 * The channels of a new list that show an agent reply that is news: its work ended since the
 * previous list, and the reader has not read it. It needs no agent list, so a caller can skip the
 * agent lookup when there is none.
 *
 * The first list of a server is only the baseline: `previous` null gives none. A host without
 * channel-attention-v1 sends no author or status, so its replies are never news.
 */
export function newChannelReplies(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
): { channel: ChannelSummary; reply: SettledReply }[] {
  if (previous === null) return [];
  const before = new Map(previous.map((channel) => [channel.id, settledReply(channel)] as const));
  return next.flatMap((channel) => {
    if (channel.archived || channel.unreadCount === 0) return [];
    const reply = settledReply(channel);
    if (!reply) return [];
    const earlier = before.get(channel.id);
    // The same reply, already settled in the list before: it was news then, not now.
    if (earlier?.author.id === reply.author.id && earlier.at === reply.at) return [];
    return [{ channel, reply }];
  });
}

/**
 * The notifications of the new replies, one for each channel. The level and the agent's own switch
 * apply as for an agent chat reply (`notificationForAgentEvent`): a reply notifies only at "all".
 */
export function channelReplyNotifications(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
  options: ChannelNotificationOptions,
): ChannelNotificationContent[] {
  if (options.level !== "all") return [];
  return newChannelReplies(previous, next).flatMap(({ channel, reply }) => {
    const agentId = reply.author.id;
    const agent = options.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.notifications) return [];
    const body =
      reply.status === "failed"
        ? options.translate("notification.failed")
        : (options.redact && plainPreview(options.redact(reply.text))) ||
          options.translate("notification.channelMessage");
    const title = options.translate("notification.channelTitle", { agent: agent.name, channel: channel.name });
    return [{ title, body, channelId: channel.id, agentId }];
  });
}

/** The channel that owns `threadId` in a channel list, from the threads of channel-attention-v1. */
export function channelForThread(
  channels: readonly ChannelSummary[],
  threadId: string | null,
): AgentNotificationChannel | null {
  if (threadId === null) return null;
  const channel = channels.find((candidate) => candidate.threads?.some((thread) => thread.threadId === threadId));
  return channel ? { id: channel.id, name: channel.name } : null;
}
