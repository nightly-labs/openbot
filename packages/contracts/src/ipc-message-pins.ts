import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessageSender, isConversationMessageSender } from "./ipc-conversation-messages";
import { isDynamicRecord } from "./runtime-values";

/** The most pins that one chat keeps. A pin over the limit is refused. */
export const MESSAGE_PINS_LIMIT = 50;

/** The most pins that the list of an agent carries: the newest pins of all its chats. */
export const MESSAGE_PINS_LIST_LIMIT = 200;

/** The most characters of a pinned message that the list carries. The list shows only its first lines. */
export const MESSAGE_PIN_TEXT_LIMIT = 1_000;

/** The most characters of the title of a pinned message's side thread that the list carries. */
export const MESSAGE_PIN_THREAD_TITLE_LIMIT = 120;

/**
 * Who pinned a message: a person, or the agent of the chat with its `pin_message` tool. A person with
 * no sender is the user of the host computer.
 */
export type MessagePinner =
  | { kind: "person"; sender: ConversationMessageSender | null }
  | { kind: "agent"; agentId: string };

/** A message that a person or the agent pinned in a chat: the agent's own chat, or one of its side threads. */
export interface PinnedMessage {
  messageId: string;
  /** The side thread that has the message, or null for the agent's own chat. */
  taskId: string | null;
  /** The title of that side thread, or null for the agent's own chat. */
  threadTitle: string | null;
  pinnedAt: string;
  pinnedBy: MessagePinner;
  /** Who wrote the message: a person, or the agent of the chat. */
  author: "user" | "agent";
  /** The person who sent the message. Null on an agent's message and on one with no recorded sender. */
  sender: ConversationMessageSender | null;
  /** The other agent that sent the message to this chat, or null. */
  senderAgentId: string | null;
  createdAt: string;
  /** The start of the message. For a message with no text, the names of its files. */
  text: string;
}

/** Pin or Unpin on one message of the agent's own chat or, with `taskId`, of one of its side threads. */
export interface SetMessagePinnedInput {
  agentId: string;
  taskId?: string;
  messageId: string;
  pinned: boolean;
}

/** The pins of all chats of an agent, the newest pin first. */
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
