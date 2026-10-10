import type { AttachmentSummary } from "./ipc-attachments";
import { isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage, type MessageReaction } from "./ipc-conversation-messages";
import { isDynamicRecord, isNumber } from "./runtime-values";

export interface ConversationSnapshot {
  agentId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messages: ConversationMessage[];
  /** Local bounded snapshots name removals; an omitted retained row is not a deletion. */
  window?: { removedMessageIds: string[] };
}

export function isConversationSnapshot(value: unknown): value is ConversationSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    (value.activeTurnId === null || isIdentifier(value.activeTurnId)) &&
    isNumber(value.revision) &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationMessage) &&
    (value.window === undefined ||
      (isDynamicRecord(value.window) &&
        Array.isArray(value.window.removedMessageIds) &&
        value.window.removedMessageIds.every(isIdentifier)))
  );
}

export interface ConversationReadState {
  unreadCount: number;
  firstUnreadMessageId: string | null;
  throughMessageId: string | null;
}

export function isConversationReadState(value: unknown): value is ConversationReadState {
  return (
    isDynamicRecord(value) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    (value.firstUnreadMessageId === null || isIdentifier(value.firstUnreadMessageId)) &&
    (value.throughMessageId === null || isIdentifier(value.throughMessageId))
  );
}

export interface ConversationWithReadState extends ConversationSnapshot {
  readState?: ConversationReadState;
}

export function isConversationWithReadState(value: unknown): value is ConversationWithReadState {
  return (
    isDynamicRecord(value) &&
    isConversationSnapshot(value) &&
    (value.readState === undefined || isConversationReadState(value.readState))
  );
}

export type ConversationPageAnchor =
  | { type: "latest" }
  | { type: "before"; cursor: string }
  | { type: "around"; messageId: string };

export interface ConversationPageInfo {
  hasOlder: boolean;
  olderCursor: string | null;
  /**
   * How many messages are older than the page, and the time of the oldest one. The chat's day rail
   * draws the part that is not loaded from these. A host that does not send them leaves them out,
   * and the Team API never carries them.
   */
  olderCount?: number;
  oldestAt?: string;
}

export interface ReadConversationPageInput {
  agentId: string;
  anchor?: ConversationPageAnchor;
  limit?: number;
  /** Local read-only keys for an existing loaded view. Does not select a thread. */
  orderProof?: ConversationOrderProofRequest;
}

export interface ConversationPage {
  agentId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messages: ConversationMessage[];
  references: Record<string, ConversationMessage>;
  pageInfo: ConversationPageInfo;
  readState?: ConversationReadState;
  /** Local latest-page members omitted by chronological paging. Canonical pagination is unchanged. */
  windowMembers?: { messages: ConversationMessage[]; visibilityFloor?: number };
  /** Optional local order keys for the canonical fragment and its hydrated members. */
  messageOrder?: ConversationMessageOrder[];
  /** Proof-mode replies carry no page bodies, cursor, or read state. */
  orderProof?: ConversationOrderProof;
}

export const CONVERSATION_ORDER_PROOF_BATCH_LIMIT = 200;

export interface ConversationOrderProofRequest {
  expectedThreadId: string;
  expectedRevision: number;
  messageIds: string[];
}

export interface ConversationOrderProof {
  agentId: string;
  threadId: string;
  revision: number;
  entries: Array<{ id: string; order: ConversationMessageOrder | null }>;
}

export function isConversationOrderProofRequest(value: unknown): value is ConversationOrderProofRequest {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.expectedThreadId) &&
    isNumber(value.expectedRevision) &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0 &&
    Array.isArray(value.messageIds) &&
    value.messageIds.length >= 1 &&
    value.messageIds.length <= CONVERSATION_ORDER_PROOF_BATCH_LIMIT &&
    value.messageIds.every(isIdentifier) &&
    new Set(value.messageIds).size === value.messageIds.length
  );
}

export function isConversationOrderProof(value: unknown): value is ConversationOrderProof {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isNumber(value.revision) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    Array.isArray(value.entries) &&
    value.entries.length >= 1 &&
    value.entries.length <= CONVERSATION_ORDER_PROOF_BATCH_LIMIT &&
    value.entries.every(
      (entry) =>
        isDynamicRecord(entry) &&
        isIdentifier(entry.id) &&
        (entry.order === null || (isConversationMessageOrder(entry.order) && entry.order.id === entry.id)),
    ) &&
    new Set(value.entries.map((entry) => entry.id)).size === value.entries.length
  );
}

/** Local SQL order of a row, computed with its complete turn, not a partial page. */
export interface ConversationMessageOrder {
  id: string;
  key: [string, number, string, number, string, number, string];
}

export function isConversationMessageOrder(value: unknown): value is ConversationMessageOrder {
  if (!isDynamicRecord(value) || !isIdentifier(value.id) || !Array.isArray(value.key) || value.key.length !== 7)
    return false;
  return (
    value.key.every((part, index) =>
      index === 1 || index === 3 || index === 5
        ? isNumber(part) && Number.isSafeInteger(part) && part >= 0 && (index !== 3 || part <= 4)
        : typeof part === "string" && (index === 0 || index === 4 || part.length > 0) && part.length <= 256,
    ) && value.key[6] === value.id
  );
}

export function compareConversationMessageOrder(
  left: ConversationMessageOrder,
  right: ConversationMessageOrder,
): number {
  for (let index = 0; index < left.key.length; index++) {
    const a = left.key[index],
      b = right.key[index];
    if (typeof a === "number" && typeof b === "number") {
      if (a !== b) return a - b;
    } else if (typeof a === "string" && typeof b === "string") {
      // SQLite BINARY uses Unicode code-point order for valid UTF-8 strings.
      const l = [...a],
        r = [...b];
      for (let at = 0; at < Math.min(l.length, r.length); at++) {
        const difference = (l[at]?.codePointAt(0) ?? 0) - (r[at]?.codePointAt(0) ?? 0);
        if (difference) return difference;
      }
      if (l.length !== r.length) return l.length - r.length;
    }
  }
  return 0;
}

/** Sort only rows with authoritative keys; legacy rows keep their original slots. */
export function orderConversationFragment<Message extends { id: string }>(
  messages: readonly Message[],
  order: readonly ConversationMessageOrder[] = [],
): Message[] {
  const keys = new Map(order.map((entry) => [entry.id, entry]));
  const known = messages
    .filter((message) => keys.has(message.id))
    .sort((left, right) => {
      const a = keys.get(left.id),
        b = keys.get(right.id);
      return a && b ? compareConversationMessageOrder(a, b) : 0;
    });
  let index = 0;
  return messages.map((message) => (keys.has(message.id) ? (known[index++] ?? message) : message));
}

/** A canonical fragment must never be passed to full-transcript turn sorting. */
export function conversationPageMessages(
  page: Pick<ConversationPage, "messages" | "windowMembers" | "messageOrder">,
): ConversationMessage[] {
  const ids = new Set(page.messages.map((message) => message.id));
  return orderConversationFragment(
    [...page.messages, ...(page.windowMembers?.messages ?? []).filter((message) => !ids.has(message.id))],
    page.messageOrder,
  );
}

export function isConversationWindowMembers(value: unknown): value is NonNullable<ConversationPage["windowMembers"]> {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.messages) &&
    value.messages.length <= 100 &&
    value.messages.every(isConversationMessage) &&
    (value.visibilityFloor === undefined ||
      (isNumber(value.visibilityFloor) && Number.isSafeInteger(value.visibilityFloor) && value.visibilityFloor > 0))
  );
}

export interface SearchConversationMessagesInput {
  query: string;
  agentId?: string;
  cursor?: string;
  limit?: number;
}

export interface ConversationSearchResult {
  agentId: string;
  message: ConversationMessage;
}

export interface ConversationSearchPage {
  results: ConversationSearchResult[];
  total: number;
  nextCursor: string | null;
}

/** A file name search across the local agent chats. An empty query lists the newest files. */
export interface SearchConversationFilesInput {
  query: string;
  cursor?: string;
  limit?: number;
}

/** One file that a message in an agent chat carries. */
export interface ConversationFileSearchResult {
  agentId: string;
  messageId: string;
  createdAt: string;
  attachment: AttachmentSummary;
}

export interface ConversationFileSearchPage {
  results: ConversationFileSearchResult[];
  nextCursor: string | null;
}

export interface MarkConversationReadInput {
  agentId: string;
  throughMessageId: string | null;
}

export interface SendMessageInput {
  agentId: string;
  text: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string | null;
  /**
   * The sender's id for this message. A second send with the same id, from the same sender to the
   * same agent, returns the first receipt instead of a new message, so a lost reply can be retried.
   */
  clientMessageId?: string;
}

export interface SetMessageReactionInput {
  agentId: string;
  messageId: string;
  emoji: MessageReaction | null;
}

export interface RespondToPromptInput {
  requestId: string | number;
  answers: Record<string, string[]>;
}
