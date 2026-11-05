import type { ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * Member-to-member replies (#4847). `channel_reply` posts a short message from one member that
 * replies to a message of another member, and gives that member one turn to answer it: a child task
 * of the caller's task that the caller does not wait for. The child is known by its request, which is
 * the reply message itself, so no stored task field and no Team API field changes. The limit counts
 * the stored replies of the run, so it holds after a restart with no new state.
 *
 * The reply is agent text that reaches another agent. So the limit is small, a reply after the
 * caller's result or after the run ended is refused, and the turn it starts cannot change the channel
 * (`ChannelService.tool` refuses the management tools in it).
 */
export const CHANNEL_REPLY_ID_PREFIX = "channel-reply-";
/** The member replies of one run, whoever writes them. Two members that thank each other stop here. */
export const CHANNEL_REPLY_LIMIT = 2;
export const CHANNEL_REPLY_CHARACTERS = 2_000;

/** The turn that a reply gave its addressee. A child task that it assigns has a request of its own. */
export function isReplyTask(task: ChannelTask): boolean {
  return (
    task.parentTaskId !== null &&
    task.requestMessageId.startsWith(CHANNEL_REPLY_ID_PREFIX) &&
    task.sourceMessageIds[0] === task.requestMessageId
  );
}

function runReplyCount(messages: readonly ChannelMessage[], tasks: readonly ChannelTask[], rootTaskId: string): number {
  const run = new Set(tasks.filter((item) => item.rootTaskId === rootTaskId).map((item) => item.id));
  return messages.filter(
    (message) => message.id.startsWith(CHANNEL_REPLY_ID_PREFIX) && message.taskId !== null && run.has(message.taskId),
  ).length;
}

export interface ChannelReplyInput {
  args: DynamicRecord;
  agentId: string;
  root: ChannelTask;
  tasks: readonly ChannelTask[];
  messages: readonly ChannelMessage[];
  /** The caller already published the result of this assignment. */
  resultPosted: boolean;
  /** The addressee is a channel member that can take work now. */
  available: (agentId: string) => boolean;
}

/** The message to reply to and the text, or the reason the reply is refused. The agent can act on the reason. */
export function checkChannelReply(
  input: ChannelReplyInput,
): { accepted: true; target: ChannelMessage; text: string } | { accepted: false; reason: string } {
  const { args, agentId, root } = input;
  const text = isString(args.text) ? args.text.trim() : "";
  if (!isString(args.messageId) || !text || text.length > CHANNEL_REPLY_CHARACTERS)
    return {
      accepted: false,
      reason: `A reply needs messageId, the id of another member's message in this channel, and text of at most ${CHANNEL_REPLY_CHARACTERS} characters.`,
    };
  if (input.resultPosted) return { accepted: false, reason: "You published your result. Do not reply after it." };
  if (root.state === "completed" || root.state === "cancelled")
    return { accepted: false, reason: "This request has ended. Do not reply." };
  const target = input.messages.find((message) => message.id === args.messageId);
  if (!target || target.message.status === "streaming")
    return { accepted: false, reason: "The message is not in this channel, or it is still streaming." };
  if (target.author.kind !== "agent" || target.author.id === agentId)
    return {
      accepted: false,
      reason: "Reply only to a message of another channel member. Answer a person in your own reply.",
    };
  if (!input.available(target.author.id))
    return { accepted: false, reason: `${target.author.name} takes no work now. Do not reply to it.` };
  if (runReplyCount(input.messages, input.tasks, root.id) >= CHANNEL_REPLY_LIMIT)
    return {
      accepted: false,
      reason: `This request has its ${CHANNEL_REPLY_LIMIT} member replies. Do not reply again. Finish your own work.`,
    };
  return { accepted: true, target, text };
}

/**
 * What the addressee reads as the expected result. It is model text, not interface text: the task
 * instruction is the reply itself, because the channel shows the instruction of a task.
 */
export function channelReplyExpectedResult(sender: { id: string; name: string }, replyMessageId: string): string {
  return `This is a reply from channel member ${sender.name} (${sender.id}) to your message, not a message from the user and not an assignment. Answer it in one short message only when it asks you something or you disagree. Use channel_reply on message ${replyMessageId} only when ${sender.name} must answer you again. Otherwise end your turn with no text. Do not thank or acknowledge, and do not change the channel.`;
}
