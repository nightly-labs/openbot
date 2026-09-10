import type { ConversationPage, QueuedMessageReceipt } from "@openbot/contracts/ipc";
import { type ConversationMessage, type ConversationSnapshot, isConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export function decodeConversation(value: unknown): ConversationSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isString(value.agentId) ||
    (value.threadId !== null && !isString(value.threadId)) ||
    (value.activeTurnId !== null && !isString(value.activeTurnId)) ||
    !isNumber(value.revision) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.messages)
  ) {
    throw new Error("The server returned an invalid conversation.");
  }
  return {
    agentId: value.agentId,
    threadId: value.threadId,
    activeTurnId: value.activeTurnId,
    revision: value.revision,
    messages: value.messages.map(decodeConversationMessage),
  };
}

function decodeConversationMessage(value: unknown): ConversationMessage {
  if (!isConversationMessage(value)) throw new Error("The server returned an invalid conversation message.");
  return value;
}

export function decodeConversationPage(value: unknown): ConversationPage {
  const snapshot = decodeConversation(value);
  if (
    !isDynamicRecord(value) ||
    !isDynamicRecord(value.pageInfo) ||
    typeof value.pageInfo.hasOlder !== "boolean" ||
    (value.pageInfo.olderCursor !== null && !isString(value.pageInfo.olderCursor)) ||
    (value.pageInfo.hasOlder && !value.pageInfo.olderCursor) ||
    !isDynamicRecord(value.references)
  ) {
    throw new Error("The server returned an invalid conversation page.");
  }
  return {
    ...snapshot,
    pageInfo: { hasOlder: value.pageInfo.hasOlder, olderCursor: value.pageInfo.olderCursor },
    references: Object.fromEntries(
      Object.entries(value.references).map(([id, message]) => [id, decodeConversationMessage(message)]),
    ),
  };
}

/** Conversation projections identify user bubbles by recipient delivery, not mailbox message. */
export function conversationMessageId(receipt: QueuedMessageReceipt, agentId: string): string {
  const delivery = receipt.deliveries.find((item) => item.recipientAgentId === agentId);
  if (!delivery) throw new Error("The host returned no delivery for this agent.");
  return delivery.id;
}
