import { INPUT_LIMITS } from "../input-limits";
import { isBoundedString, isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";

export const TEAM_QUEUE_EDIT_CAPABILITY = "queue-edit-v1";
export type QueueEditRequest =
  | { action: "begin" | "cancel"; deliveryId: string; editId: string }
  | {
      action: "save";
      deliveryId: string;
      editId: string;
      text: string;
      keepAttachmentIds: string[];
      attachmentDraftIds: string[];
    };
export function isQueueEditRoute(method: string, path: string): boolean {
  return (
    method === "POST" && /^\/v1\/agents\/[^/]+\/queue\/edit$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}
export function decodeQueueEditRequest(value: unknown): QueueEditRequest {
  if (!isDynamicRecord(value) || !isIdentifier(value.deliveryId) || !isIdentifier(value.editId))
    throw new Error("Invalid queue edit request.");
  if (value.action === "begin" || value.action === "cancel")
    return { action: value.action, deliveryId: value.deliveryId, editId: value.editId };
  if (
    value.action !== "save" ||
    !isBoundedString(value.text, INPUT_LIMITS.messageText) ||
    !Array.isArray(value.keepAttachmentIds) ||
    !value.keepAttachmentIds.every(isIdentifier) ||
    !Array.isArray(value.attachmentDraftIds) ||
    !value.attachmentDraftIds.every(isIdentifier) ||
    value.keepAttachmentIds.length + value.attachmentDraftIds.length > INPUT_LIMITS.attachments
  )
    throw new Error("Invalid queue edit request.");
  return {
    action: "save",
    deliveryId: value.deliveryId,
    editId: value.editId,
    text: value.text,
    keepAttachmentIds: value.keepAttachmentIds,
    attachmentDraftIds: value.attachmentDraftIds,
  };
}
