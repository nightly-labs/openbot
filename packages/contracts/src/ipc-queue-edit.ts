import { INPUT_LIMITS } from "./input-limits";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export type QueueEditInput = { agentId: string } & (
  | { operation: "read" }
  | { operation: "begin"; deliveryId: string }
  | { operation: "cancel"; deliveryId: string; revision: number }
  | { operation: "save" | "send"; deliveryId: string; revision: number; text: string; attachmentDraftIds: string[] }
);
export interface QueueEditState {
  deliveryId: string;
  revision: number;
  text: string;
  attachments: AttachmentSummary[];
  replyToMessageId: string | null;
}
export function parseQueueEditInput(value: unknown): QueueEditInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId)) throw new Error("Invalid queue edit request.");
  const agentId = value.agentId;
  if (value.operation === "read") return { agentId, operation: "read" };
  if (!isIdentifier(value.deliveryId)) throw new Error("Invalid queue edit delivery.");
  const deliveryId = value.deliveryId;
  if (value.operation === "begin") return { agentId, deliveryId, operation: "begin" };
  if (!Number.isSafeInteger(value.revision) || typeof value.revision !== "number" || value.revision < 1)
    throw new Error("Invalid queue edit revision.");
  const revision = value.revision;
  if (value.operation === "cancel") return { agentId, deliveryId, revision, operation: "cancel" };
  if (
    (value.operation !== "save" && value.operation !== "send") ||
    typeof value.text !== "string" ||
    value.text.length > INPUT_LIMITS.messageText ||
    !Array.isArray(value.attachmentDraftIds) ||
    value.attachmentDraftIds.length > INPUT_LIMITS.attachments ||
    !value.attachmentDraftIds.every(isIdentifier)
  )
    throw new Error("Invalid queue edit content.");
  return {
    agentId,
    deliveryId,
    revision,
    operation: value.operation,
    text: value.text,
    attachmentDraftIds: value.attachmentDraftIds,
  };
}
export function decodeQueueEditState(value: unknown): QueueEditState | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.deliveryId) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.text !== "string" ||
    !Array.isArray(value.attachments) ||
    !value.attachments.every(isAttachmentSummary) ||
    !(value.replyToMessageId === null || isIdentifier(value.replyToMessageId))
  )
    throw new Error("Invalid queue edit state.");
  return {
    deliveryId: value.deliveryId,
    revision: value.revision,
    text: value.text,
    attachments: value.attachments,
    replyToMessageId: value.replyToMessageId,
  };
}
