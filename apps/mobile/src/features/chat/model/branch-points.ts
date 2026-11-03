import {
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
} from "@openbot/contracts/ipc";
import { type ChatMessage, sortedConversationMessages } from "./chat-messages";

/** The stored message of a chat row: a marker row has the id of its message after a prefix. */
const ROW_PREFIXES = ["exchange:", "context-reset:", "routine:"];
function rowMessageId(row: ChatMessage): string {
  const prefix = ROW_PREFIXES.find((value) => row.id.startsWith(value));
  return prefix ? row.id.slice(prefix.length) : row.id;
}

/**
 * The row that the "Branched from" line follows: the last shown row of the copied messages. The last
 * copied message can be a row that the chat does not show, such as a thought, so the line goes after
 * the last row at or before it. Null when the conversation does not have the message.
 */
export function branchDividerRowId(
  messages: readonly ConversationMessage[],
  rows: readonly ChatMessage[],
  throughMessageId: string,
): string | null {
  const sorted = sortedConversationMessages(messages);
  const through = sorted.findIndex((message) => message.id === throughMessageId);
  if (through < 0) return null;
  const copied = new Set(sorted.slice(0, through + 1).map((message) => message.id));
  return rows.findLast((row) => row.kind !== "thinking" && copied.has(rowMessageId(row)))?.id ?? null;
}

/** A finished answer of the agent, with a bubble. A branch copies the conversation through such a message. */
function branchable(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.status !== "streaming" &&
    message.itemType !== "commentary" &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    message.itemType !== CONVERSATION_SUBAGENTS_ITEM_TYPE &&
    !message.questionPrompt &&
    !message.exchange &&
    !message.routine &&
    (message.text.trim().length > 0 || Boolean(message.attachments?.length) || Boolean(message.imageGeneration))
  );
}

/**
 * The messages that show "Branch from here", as on desktop: the last answer of the agent in each
 * finished turn. A message of the person, or an answer of another turn, ends a turn. The last answer
 * counts only when its turn does not run and no message after it streams. A queued message is not
 * in the chat yet, so it does not end a turn.
 */
export function branchPointIds(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  let candidate: ConversationMessage | undefined;
  let streamingAfter = false;
  const otherTurn = (message: ConversationMessage) =>
    candidate?.turnId !== undefined && message.turnId !== undefined && candidate.turnId !== message.turnId;
  for (const message of sortedConversationMessages(messages)) {
    if (message.delivery?.status === "queued" || message.delivery?.status === "cancelled") continue;
    if (message.author === "user" || otherTurn(message)) {
      if (candidate) ids.add(candidate.id);
      candidate = undefined;
      streamingAfter = false;
    }
    if (message.author === "user") continue;
    if (branchable(message)) {
      candidate = message;
      streamingAfter = false;
    } else if (message.status === "streaming") streamingAfter = true;
  }
  const ended = candidate?.turnId === undefined ? !activeTurnId : candidate.turnId !== activeTurnId;
  if (candidate && ended && !streamingAfter) ids.add(candidate.id);
  return ids;
}
