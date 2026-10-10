import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isConversationMessageVisible, isConversationVisibilityAfter } from "@openbot/contracts/ipc";

export const CONVERSATION_CACHE_MESSAGE_LIMIT = 100;
export const CONVERSATION_CACHE_BYTES_LIMIT = 8 * 1024 * 1024;
export const CONVERSATION_CACHE_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;

/** Only a running turn exempts its messages and streaming responses from history budgets. */
export function isActiveConversationMessage(message: ConversationMessage, activeTurnId: string | null): boolean {
  return activeTurnId !== null && (message.turnId === activeTurnId || message.status === "streaming");
}

export { conversationPageMessages } from "@openbot/contracts/ipc";

export function conversationVisibilityFloor(messages: readonly ConversationMessage[]): number | undefined {
  const epochs = messages.flatMap((message) =>
    message.visibilityEpoch === undefined || !isConversationMessageVisible(message) ? [] : [message.visibilityEpoch],
  );
  return epochs.length > 0 ? Math.min(...epochs) : undefined;
}

/** Completed history shares one count/byte budget, including late-visible supplemental members. */
export function retainConversationMessages(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  envelopeBytes = 2,
): ConversationMessage[] {
  const active = messages.filter((message) => isActiveConversationMessage(message, activeTurnId));
  const activeIds = new Set(active.map((message) => message.id));
  const completed = messages.filter((message) => !activeIds.has(message.id));
  const tail = completed.slice(-CONVERSATION_CACHE_MESSAGE_LIMIT);
  const floor = conversationVisibilityFloor(tail);
  const tailIds = new Set(tail.map((message) => message.id));
  const late =
    floor === undefined
      ? []
      : completed
          .filter(
            (message) =>
              !tailIds.has(message.id) &&
              isConversationMessageVisible(message) &&
              isConversationVisibilityAfter(message, floor),
          )
          .sort((left, right) => (right.visibilityEpoch ?? 0) - (left.visibilityEpoch ?? 0));
  const priority = [...late, ...tail.toReversed()].slice(0, CONVERSATION_CACHE_MESSAGE_LIMIT);
  const retained: ConversationMessage[] = [];
  let bytes = envelopeBytes;
  for (const message of priority) {
    const size = Buffer.byteLength(JSON.stringify(message), "utf8") + 1;
    if (bytes + size > CONVERSATION_CACHE_BYTES_LIMIT) continue;
    retained.push(message);
    bytes += size;
  }
  const retainedIds = new Set([...retained, ...active].map((message) => message.id));
  return messages.filter((message) => retainedIds.has(message.id));
}
