// What main answers for a conversation: its pages, search, read state, attachments, queue and file
// previews.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type ConversationMessage,
  type ConversationPage,
  type ConversationReadState,
  type ConversationSearchPage,
  type ConversationWithReadState,
  type DraftAttachment,
  type FilePreview,
  isAttachmentSummary,
  isConversationMessage,
  isConversationReadState,
  isConversationWithReadState,
  isFilePreviewKind,
  isQueuedMessageReceipt,
  isQueueSnapshot,
  type QueuedMessageReceipt,
  type QueueSnapshot,
} from "@openbot/contracts/ipc";
import {
  decodeRecord,
  guardedListDecoder,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export function decodeFilePreview(value: unknown): FilePreview {
  const preview = decodeRecord(value, "file preview");
  if (
    !isString(preview.name) ||
    !isNumber(preview.size) ||
    !isString(preview.mimeType) ||
    !isFilePreviewKind(preview.previewKind) ||
    (preview.bytes !== null && !(preview.bytes instanceof Uint8Array))
  ) {
    throw new Error("Invalid file preview response.");
  }
  return {
    name: preview.name,
    size: preview.size,
    mimeType: preview.mimeType,
    previewKind: preview.previewKind,
    bytes: preview.bytes,
  };
}

export function decodeConversation(value: unknown): ConversationWithReadState {
  if (!isConversationWithReadState(value)) throw new Error("Invalid conversation response.");
  return value;
}

export function decodeConversationPageFromMain(value: unknown): ConversationPage {
  if (!isDynamicRecord(value) || !isString(value.agentId) || !Array.isArray(value.messages)) {
    throw new Error("Invalid conversation page response.");
  }
  const pageInfo = decodeRecord(value.pageInfo, "conversation page info");
  return {
    agentId: value.agentId,
    threadId: nullableString(value, "threadId"),
    activeTurnId: nullableString(value, "activeTurnId"),
    revision: requiredNumber(value, "revision"),
    messages: decodeConversationMessages(value.messages),
    references: decodeConversationReferencesFromMain(value.references),
    pageInfo: {
      hasOlder: requiredBoolean(pageInfo, "hasOlder"),
      olderCursor: nullableString(pageInfo, "olderCursor"),
    },
    ...(value.readState === undefined ? {} : { readState: decodeReadState(value.readState) }),
  };
}

export function decodeConversationSearchPageFromMain(value: unknown): ConversationSearchPage {
  const item = decodeRecord(value, "conversation search page");
  if (!Array.isArray(item.results)) throw new Error("Invalid conversation search results.");
  return {
    results: item.results.map((value) => {
      const result = decodeRecord(value, "conversation search result");
      if (!isConversationMessage(result.message)) throw new Error("Invalid conversation search message.");
      return { agentId: requiredString(result, "agentId"), message: result.message };
    }),
    total: requiredNumber(item, "total"),
    nextCursor: nullableString(item, "nextCursor"),
  };
}

const decodeConversationMessages = guardedListDecoder(isConversationMessage, "conversation messages");

function decodeConversationReferencesFromMain(value: unknown): Record<string, ConversationMessage> {
  const references = decodeRecord(value, "conversation references");
  const decoded: Record<string, ConversationMessage> = {};
  for (const [messageId, message] of Object.entries(references)) {
    if (!isConversationMessage(message)) throw new Error("Invalid conversation reference.");
    decoded[messageId] = message;
  }
  return decoded;
}

export function decodeReadState(value: unknown): ConversationReadState {
  if (!isConversationReadState(value)) throw new Error("Invalid conversation read state.");
  return value;
}

export function decodeReadStates(value: unknown): Record<string, ConversationReadState> {
  const item = decodeRecord(value, "conversation reads");
  return Object.fromEntries(Object.entries(item).map(([agentId, state]) => [agentId, decodeReadState(state)]));
}

export function decodeAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value) || !value.every(isAttachmentSummary)) {
    throw new Error("Invalid attachment response.");
  }
  return value;
}

export function decodeReceipt(value: unknown): QueuedMessageReceipt {
  if (!isQueuedMessageReceipt(value)) {
    throw new Error("Invalid queued message response.");
  }
  return value;
}

export function decodeQueue(value: unknown): QueueSnapshot {
  if (!isQueueSnapshot(value)) {
    throw new Error("Invalid queue response.");
  }
  return value;
}
