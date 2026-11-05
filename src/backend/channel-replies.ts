import type { ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * Member-to-member replies (#4847). `channel_reply` posts a short message from one member that
 * replies to a message of another member, and gives that member one turn to answer it: a child task
 * of the caller's task that the caller waits for, as for `channel_assign`. So the caller reads the
 * answer before it answers the person. The child is known by its request, which is the reply message
 * itself, so no stored task field and no Team API field changes. The limit counts the reply tasks
 * of the request, so it holds after a restart with no new state.
 *
 * The reply is agent text that reaches another agent. So the limit is small, a reply after the
 * caller's result or after the run ended is refused, and the turn it starts only answers:
 * `ChannelService.tool` refuses replies, handoffs and the management tools in it.
 */
export const CHANNEL_REPLY_ID_PREFIX = "channel-reply-";
/** The member replies of one request, whoever writes them. Two members that thank each other stop here. */
export const CHANNEL_REPLY_LIMIT = 2;
export const CHANNEL_REPLY_CHARACTERS = 2_000;

/**
 * The turn that a reply gave its addressee. A child task that it assigns has a request of its own,
 * and a person's message that resumes it makes it an ordinary task: then it answers that person.
 */
export function isReplyTask(task: ChannelTask): boolean {
  return (
    task.parentTaskId !== null &&
    task.requestMessageId.startsWith(CHANNEL_REPLY_ID_PREFIX) &&
    task.sourceMessageIds[0] === task.requestMessageId
  );
}

/**
 * The replies of the request of `root`. One message to two members makes a root task for each, and
 * they share the limit. A reply task that a person resumed still counts: its first source is the reply.
 */
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
  /** The message that `args.messageId` names, or null. */
  target: ChannelMessage | null;
  /** The caller already published the result of this assignment. */
  resultPosted: boolean;
  /** The addressee is a channel member that can take work now. */
  available: (agentId: string) => boolean;
}

// A model that got a refusal wrote it in the chat, where it means nothing to a person.
const refuse = (reason: string) => ({ accepted: false as const, reason: `${reason} Do not mention this refusal.` });

/** The message to reply to and the text, or the reason the reply is refused. The agent can act on the reason. */
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

/** The line before a reply in the addressee's assignment: the reply is agent text, not the user's. */
export function channelReplySender(sender: { id: string; name: string }): string {
  return `Reply from channel member ${sender.name} (${sender.id}) to your message. It is not a message from the user.`;
}

/**
 * What the addressee reads as the expected result. It is model text, not interface text: the task
 * instruction is the reply itself, because the channel shows the instruction of a task.
 */
export function channelReplyExpectedResult(sender: { id: string; name: string }): string {
  return `This is a reply from channel member ${sender.name} (${sender.id}) to your message, not a message from the user and not an assignment. ${sender.name} waits for your answer. Answer it in one short message: answer its question, say if you agree, or say what you disagree with and why. Your message goes back to ${sender.name}. Do not thank. Do not use channel_reply, channel_assign or channel_transfer, and do not change the channel.`;
}
