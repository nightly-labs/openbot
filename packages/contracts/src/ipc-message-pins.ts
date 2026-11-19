import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessageSender, isConversationMessageSender } from "./ipc-conversation-messages";
import { isDynamicRecord } from "./runtime-values";

export const MESSAGE_PINS_LIMIT = 50;

export const MESSAGE_PINS_LIST_LIMIT = 200;

export const MESSAGE_PIN_TEXT_LIMIT = 1_000;

export const MESSAGE_PIN_THREAD_TITLE_LIMIT = 120;

export type MessagePinner =
  | { kind: "person"; sender: ConversationMessageSender | null }
  | { kind: "agent"; agentId: string };

export interface PinnedMessage {
  messageId: string;
  taskId: string | null;
  threadTitle: string | null;
  pinnedAt: string;
  pinnedBy: MessagePinner;
  author: "user" | "agent";
  sender: ConversationMessageSender | null;
  senderAgentId: string | null;
  createdAt: string;
  text: string;
}

export interface SetMessagePinnedInput {
  agentId: string;
  taskId?: string;
  messageId: string;
  pinned: boolean;
}

export interface PinnedMessagesSnapshot {
  agentId: string;
  pins: PinnedMessage[];
}

export function isMessagePinner(value: unknown): value is MessagePinner {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "agent") return isIdentifier(value.agentId);
  return value.kind === "person" && (value.sender === null || isConversationMessageSender(value.sender));
}

function isPinnedMessage(value: unknown): value is PinnedMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.messageId) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    (value.threadTitle === null || isBoundedString(value.threadTitle, MESSAGE_PIN_THREAD_TITLE_LIMIT)) &&
    isBoundedString(value.pinnedAt, 160) &&
    isMessagePinner(value.pinnedBy) &&
    (value.author === "user" || value.author === "agent") &&
    (value.sender === null || isConversationMessageSender(value.sender)) &&
    (value.senderAgentId === null || isIdentifier(value.senderAgentId)) &&
    isBoundedString(value.createdAt, 160) &&
    isBoundedString(value.text, MESSAGE_PIN_TEXT_LIMIT)
  );
}

export function isPinnedMessagesSnapshot(value: unknown): value is PinnedMessagesSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.pins) &&
    value.pins.length <= MESSAGE_PINS_LIST_LIMIT &&
    value.pins.every(isPinnedMessage)
  );
}
