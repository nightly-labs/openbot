import { isQueueSnapshot, type QueueDelivery } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { ChatMessage } from "./chat-messages";

export interface QueueEditDraft {
  editId: string;
  initialized: boolean;
  delivery: QueueDelivery;
  text: string;
  keepAttachmentIds: string[];
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
  const snapshot = { agentId: value.delivery.recipientAgentId, deliveries: [value.delivery] };
  if (!isQueueSnapshot(snapshot)) throw new Error("Could not read the saved queue edit.");
  return {
    editId: value.editId,
    initialized: value.initialized,
    delivery: snapshot.deliveries[0],
    text: value.text,
    keepAttachmentIds: value.keepAttachmentIds,
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
