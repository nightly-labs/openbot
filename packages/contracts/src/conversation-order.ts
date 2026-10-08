// The order a conversation's messages are shown in, on every surface that shows them.
//
// The desktop backend sorts a transcript before it stores or sends it, and the mobile app sorts the
// pages it merges. The two copies drifted once already, so there is one.

import type { ConversationMessage } from "./ipc-conversation-messages";

/**
 * Sorts `messages` in place and returns the same array. Turns go by their earliest message, and
 * inside one turn the user's message comes first, then commentary and the plan, then the answer. A message with
 * no valid `createdAt` goes last.
 *
 * A turn can take a second message from the user, a steer. From the steer on, the turn goes by time, so
 * the steer comes after the commentary the agent sent before it, and Grok's answers to the first message
 * and to the steer stay in the order they came (#1540).
 */
export function sortConversationMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const originalIndexes = new Map(messages.map((message, index) => [message, index]));
  const groupKeys = new Map<ConversationMessage, string>();
  const groups = new Map<string, { startedAt: number; firstIndex: number }>();

  for (const [index, message] of messages.entries()) {
    const groupKey = message.turnId ? `turn:${message.turnId}` : `message:${index}`;
    const createdAt = messageTime(message);
    const group = groups.get(groupKey);
    groupKeys.set(message, groupKey);
    if (group) {
      group.startedAt = Math.min(group.startedAt, createdAt);
      group.firstIndex = Math.min(group.firstIndex, index);
    } else {
      groups.set(groupKey, { startedAt: createdAt, firstIndex: index });
    }
  }
  const steeredAt = turnSteerTimes(messages);

  messages.sort((left, right) => {
    const leftGroup = groups.get(groupKeys.get(left) ?? "");
    const rightGroup = groups.get(groupKeys.get(right) ?? "");
    if (leftGroup && rightGroup && leftGroup !== rightGroup) {
      if (leftGroup.startedAt !== rightGroup.startedAt) return leftGroup.startedAt - rightGroup.startedAt;
      if (leftGroup.firstIndex !== rightGroup.firstIndex) return leftGroup.firstIndex - rightGroup.firstIndex;
    }

    if (left.turnId && left.turnId === right.turnId) {
      const steerAt = steeredAt.get(left.turnId);
      const leftSteered = steerAt !== undefined && messageTime(left) >= steerAt;
      const rightSteered = steerAt !== undefined && messageTime(right) >= steerAt;
      if (leftSteered !== rightSteered) return leftSteered ? 1 : -1;
      const rankDifference = leftSteered ? 0 : turnMessageRank(left) - turnMessageRank(right);
      if (rankDifference !== 0) return rankDifference;
    }
    const timeDifference = messageTime(left) - messageTime(right);
    if (timeDifference !== 0) return timeDifference;
    return (originalIndexes.get(left) ?? 0) - (originalIndexes.get(right) ?? 0);
  });
  return messages;
}

/** When each steered turn took its second message from the user. */
function turnSteerTimes(messages: readonly ConversationMessage[]): Map<string, number> {
  const userTimes = new Map<string, number[]>();
  for (const message of messages) {
    if (!message.turnId || turnMessageRank(message) !== 0) continue;
    const times = userTimes.get(message.turnId) ?? [];
    times.push(messageTime(message));
    userTimes.set(message.turnId, times);
  }
  const steeredAt = new Map<string, number>();
  for (const [turnId, times] of userTimes) {
    const second = times.sort((left, right) => left - right)[1];
    if (second !== undefined) steeredAt.set(turnId, second);
  }
  return steeredAt;
}

function messageTime(message: ConversationMessage): number {
  const timestamp = Date.parse(message.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function turnMessageRank(message: ConversationMessage): 0 | 1 | 2 | 3 {
  if (message.exchange?.direction === "incoming" || message.author === "user") return 0;
  if (message.author === "assistant" && (message.itemType === "commentary" || message.itemType === "plan")) return 1;
  if (message.exchange?.direction === "outgoing") return 2;
  if (message.author === "assistant") return 3;
  return 2;
}
