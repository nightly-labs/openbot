// The order a conversation's messages are shown in, on every surface that shows them.
//
// The desktop backend sorts a transcript before it stores or sends it, and the mobile app sorts the
// pages it merges. The two copies drifted once already, so there is one.

import type { ConversationMessage } from "./ipc-conversation-messages";

/**
 * Sorts `messages` in place and returns the same array. Turns go by their earliest message, and
 * inside one turn the user's message comes first, then commentary, then the answer. A message with
 * no valid `createdAt` goes last.
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

  messages.sort((left, right) => {
    const leftGroup = groups.get(groupKeys.get(left) ?? "");
    const rightGroup = groups.get(groupKeys.get(right) ?? "");
    if (leftGroup && rightGroup && leftGroup !== rightGroup) {
      if (leftGroup.startedAt !== rightGroup.startedAt) return leftGroup.startedAt - rightGroup.startedAt;
      if (leftGroup.firstIndex !== rightGroup.firstIndex) return leftGroup.firstIndex - rightGroup.firstIndex;
    }

    if (left.turnId && left.turnId === right.turnId) {
      const rankDifference = turnMessageRank(left) - turnMessageRank(right);
      if (rankDifference !== 0) return rankDifference;
    }
    const timeDifference = messageTime(left) - messageTime(right);
    if (timeDifference !== 0) return timeDifference;
    return (originalIndexes.get(left) ?? 0) - (originalIndexes.get(right) ?? 0);
  });
  return messages;
}

function messageTime(message: ConversationMessage): number {
  const timestamp = Date.parse(message.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function turnMessageRank(message: ConversationMessage): 0 | 1 | 2 | 3 {
  if (message.exchange?.direction === "incoming" || message.author === "user") return 0;
  if (message.author === "assistant" && message.itemType === "commentary") return 1;
  if (message.exchange?.direction === "outgoing") return 2;
  if (message.author === "assistant") return 3;
  return 2;
}
