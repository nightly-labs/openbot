import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isQueueSnapshot, type QueueDelivery } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { ChatMessage } from "./chat-messages";

export interface StoredQueueAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  fileName: string;
}

function isStoredQueueAttachment(value: unknown): value is StoredQueueAttachment {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.mimeType) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    isString(value.fileName) &&
    /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(value.fileName) &&
    !value.fileName.includes("..")
  );
}

export interface QueueEditDraft {
  editId: string;
  initialized: boolean;
  delivery: QueueDelivery;
  text: string;
  keepAttachmentIds: string[];
  addedAttachments: StoredQueueAttachment[];
}

export function decodeQueueEditDraft(raw: string | null): QueueEditDraft | null {
  if (!raw) return null;
  return parseQueueEditDraft(JSON.parse(raw));
}

function parseQueueEditDraft(value: unknown): QueueEditDraft {
  if (
    !isDynamicRecord(value) ||
    !isString(value.editId) ||
    !isBoolean(value.initialized) ||
    !isString(value.text) ||
    !Array.isArray(value.keepAttachmentIds) ||
    !value.keepAttachmentIds.every(isString) ||
    !isDynamicRecord(value.delivery)
  )
    throw new Error("Could not read the saved queue edit.");
  const addedAttachments = value.addedAttachments ?? [];
  if (
    !Array.isArray(addedAttachments) ||
    addedAttachments.length > INPUT_LIMITS.attachments ||
    !addedAttachments.every(isStoredQueueAttachment)
  )
    throw new Error("Could not read the saved edit attachments.");
  const snapshot = { agentId: value.delivery.recipientAgentId, deliveries: [value.delivery] };
  if (!isQueueSnapshot(snapshot)) throw new Error("Could not read the saved queue edit.");
  return {
    editId: value.editId,
    initialized: value.initialized,
    delivery: snapshot.deliveries[0],
    text: value.text,
    keepAttachmentIds: value.keepAttachmentIds,
    addedAttachments,
  };
}

export function orderedQueue(deliveries: QueueDelivery[]): QueueDelivery[] {
  return deliveries
    .filter((item) => item.status === "queued")
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * The host hides a held-for-edit delivery from a fresh queue snapshot: listQueue only
 * returns it to the holder. Keep the held copy in the list, so an edit in progress still
 * has its row after the snapshot refreshes.
 */
export function queueRowsWithHeldEdit(queued: QueueDelivery[], held: QueueDelivery | null): QueueDelivery[] {
  if (!held) return queued;
  return orderedQueue([held, ...queued.filter((item) => item.id !== held.id)]);
}

/** Conversation rows and send receipts use delivery IDs, not the shared mailbox message ID. */
export function queueReceiptMessages(deliveries: QueueDelivery[]): ChatMessage[] {
  return [...deliveries]
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .map((delivery) => ({
      kind: "message",
      id: delivery.id,
      author: delivery.sender.kind === "user" ? "user" : "agent",
      body: delivery.text,
      streaming: false,
      attachments: delivery.attachments,
    }));
}
