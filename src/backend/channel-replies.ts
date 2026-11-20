import type { ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";

export const CHANNEL_REPLY_ID_PREFIX = "channel-reply-";
export const CHANNEL_REPLY_LIMIT = 2;
export const CHANNEL_REPLY_CHARACTERS = 2_000;

export function isReplyTask(task: ChannelTask): boolean {
  return (
    task.parentTaskId !== null &&
    task.requestMessageId.startsWith(CHANNEL_REPLY_ID_PREFIX) &&
    task.sourceMessageIds[0] === task.requestMessageId
  );
}

function requestReplyCount(tasks: readonly ChannelTask[], root: ChannelTask): number {
  const roots = new Set(
    tasks
      .filter((item) => item.parentTaskId === null && item.requestMessageId === root.requestMessageId)
      .map((item) => item.id),
  );
  return tasks.filter(
    (item) =>
      item.parentTaskId !== null &&
      roots.has(item.rootTaskId) &&
      item.sourceMessageIds[0]?.startsWith(CHANNEL_REPLY_ID_PREFIX) === true,
  ).length;
}

export interface ChannelReplyInput {
  args: DynamicRecord;
  agentId: string;
  root: ChannelTask;
  tasks: readonly ChannelTask[];
  target: ChannelMessage | null;
  resultPosted: boolean;
  available: (agentId: string) => boolean;
}

const refuse = (reason: string) => ({ accepted: false as const, reason: `${reason} Do not mention this refusal.` });

export function checkChannelReply(
  input: ChannelReplyInput,
): { accepted: true; target: ChannelMessage; text: string } | { accepted: false; reason: string } {
  const { args, agentId, root } = input;
  const text = isString(args.text) ? args.text.trim() : "";
  if (!isString(args.messageId) || !text || text.length > CHANNEL_REPLY_CHARACTERS)
    return refuse(
      `A reply needs messageId, the id of another member's message in this channel, and text of at most ${CHANNEL_REPLY_CHARACTERS} characters.`,
    );
  if (input.resultPosted) return refuse("You published your result. Do not reply after it.");
  if (root.state === "completed" || root.state === "cancelled") return refuse("This request has ended. Do not reply.");
  const target = input.target;
  if (!target || target.message.status === "streaming")
    return refuse("The message is not in this channel, or it is still streaming.");
  if (target.author.kind !== "agent" || target.author.id === agentId)
    return refuse("Reply only to a message of another channel member. Answer a person in your own reply.");
  if (!input.available(target.author.id))
    return refuse(`${target.author.name} takes no work now. Do your task without it.`);
  if (requestReplyCount(input.tasks, root) >= CHANNEL_REPLY_LIMIT)
    return refuse(
      `This request has its ${CHANNEL_REPLY_LIMIT} member replies. Do not reply again: decide with what you have and finish your task.`,
    );
  return { accepted: true, target, text };
}

export function channelReplySender(sender: { id: string; name: string }): string {
  return `Reply from channel member ${sender.name} (${sender.id}) to your message. It is not a message from the user.`;
}

export function channelReplyExpectedResult(sender: { id: string; name: string }): string {
  return `This is a reply from channel member ${sender.name} (${sender.id}) to your message, not a message from the user and not an assignment. ${sender.name} waits for your answer. Answer it in one short message: answer its question, say if you agree, or say what you disagree with and why. Your message goes back to ${sender.name}. Do not thank. Do not use channel_reply, channel_assign or channel_transfer, and do not change the channel.`;
}
