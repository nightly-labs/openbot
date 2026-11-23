import type {
  ChannelPreview,
  ChannelSummary,
  ClientAgentSummary,
  ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type AgentNotificationChannel, agentNotificationLevel, plainPreview } from "./agent-notifications";

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
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null;
  redact: ((text: string) => string) | null;
}

type SettledReply = ChannelPreview & { author: { kind: "agent"; id: string } };

function settledReply(channel: ChannelSummary): SettledReply | null {
  const last = channel.lastMessage;
  if ((channel.openTasks ?? channel.activeTasks) > 0 || last?.author?.kind !== "agent") return null;
  if (last.status !== "completed" && last.status !== "failed") return null;
  return { ...last, author: { kind: "agent", id: last.author.id } };
}

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
    if (earlier?.author.id === reply.author.id && earlier.at === reply.at) return [];
    return [{ channel, reply }];
  });
}

export function channelReplyNotifications(
  previous: readonly ChannelSummary[] | null,
  next: readonly ChannelSummary[],
  options: ChannelNotificationOptions,
): ChannelNotificationContent[] {
  if (options.level !== "all") return [];
  return newChannelReplies(previous, next).flatMap(({ channel, reply }) => {
    const agentId = reply.author.id;
    const agent = options.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.notifications || agentNotificationLevel(options.level, options.agentLevels, agentId) !== "all")
      return [];
    const body =
      reply.status === "failed"
        ? options.translate("notification.failed")
        : (options.redact && plainPreview(options.redact(reply.text))) ||
          options.translate("notification.channelMessage");
    const title = options.translate("notification.channelTitle", { agent: agent.name, channel: channel.name });
    return [{ title, body, channelId: channel.id, agentId }];
  });
}

export function channelForThread(
  channels: readonly ChannelSummary[],
  threadId: string | null,
): AgentNotificationChannel | null {
  if (threadId === null) return null;
  const channel = channels.find((candidate) => candidate.threads?.some((thread) => thread.threadId === threadId));
  return channel ? { id: channel.id, name: channel.name } : null;
}
