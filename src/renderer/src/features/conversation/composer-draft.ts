import { attachmentReferenceIds } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type DraftAttachment,
  isAttachmentSummary,
  type MarketplaceSkillDetail,
  SKILL_CREATION_REQUEST,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeQueueEditRequest, type QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { skillExamplePrompt } from "@openbot/ui/components/SkillPreview";
import type { ComposerSelection } from "@openbot/ui/features/conversation/ComposerEditor";
import type { ComposerDraft } from "./conversation-types";

export const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
  replyToMessageId: null,
};

export function copyComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    attachments: [...draft.attachments],
    replyToMessageId: draft.replyToMessageId,
  };
}

export function appendSkillExample(
  draft: ComposerDraft,
  skill: Pick<MarketplaceSkillDetail, "id" | "name" | "examplePrompt">,
): ComposerDraft {
  return appendDraftLine(
    draft,
    `${serializeChatTagReference("skill", skill.name, skill.id)} ${skillExamplePrompt(skill)}`,
  );
}

export function appendSkillCreationRequest(draft: ComposerDraft): ComposerDraft {
  return appendDraftLine(draft, SKILL_CREATION_REQUEST);
}

export function appendDraftText(draft: ComposerDraft, text: string): ComposerDraft {
  const trimmed = text.trim();
  return trimmed ? appendDraftLine(draft, trimmed) : draft;
}

function appendDraftLine(draft: ComposerDraft, line: string): ComposerDraft {
  return { ...draft, text: draft.text ? `${draft.text}\n${line}` : line };
}

export const QUEUE_EDIT_STORAGE_KEY = "openbot:queue-edit";
type StoredQueueSave = Extract<QueueEditRequest, { action: "save" }>;
export interface StoredQueueEdit {
  agentId: string;
  serverId: string;
  deliveryId: string;
  editId: string;
  originalAttachmentIds: string[];
  originalText?: string;
  draft: ComposerDraft;
  backup: ComposerDraft;
  pendingSave?: StoredQueueSave;
}
function isComposerDraft(value: unknown): value is ComposerDraft {
  return (
    isDynamicRecord(value) &&
    isString(value.text) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAttachmentSummary) &&
    (value.replyToMessageId === null || isString(value.replyToMessageId))
  );
}
export function clearStoredQueueEdit(): void {
  try {
    window.localStorage.removeItem(QUEUE_EDIT_STORAGE_KEY);
  } catch {}
}
export function readStoredQueueEdit(): StoredQueueEdit | null {
  try {
    return decodeStoredQueueEdit(JSON.parse(window.localStorage.getItem(QUEUE_EDIT_STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function decodeStoredQueueEdit(value: unknown): StoredQueueEdit | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.agentId) ||
    !isString(value.serverId) ||
    !isString(value.deliveryId) ||
    !isString(value.editId) ||
    !Array.isArray(value.originalAttachmentIds) ||
    !value.originalAttachmentIds.every(isString) ||
    (value.originalText !== undefined && !isString(value.originalText)) ||
    !isComposerDraft(value.draft) ||
    !isComposerDraft(value.backup)
  )
    return null;
  let pendingSave: StoredQueueSave | undefined;
  if (value.pendingSave !== undefined) {
    try {
      const decoded = decodeQueueEditRequest(value.pendingSave);
      if (decoded.action !== "save" || decoded.editId !== value.editId || decoded.deliveryId !== value.deliveryId)
        return null;
      pendingSave = decoded;
    } catch {
      return null;
    }
  }
  return {
    agentId: value.agentId,
    serverId: value.serverId,
    deliveryId: value.deliveryId,
    editId: value.editId,
    originalAttachmentIds: value.originalAttachmentIds,
    ...(isString(value.originalText) ? { originalText: value.originalText } : {}),
    draft: value.draft,
    backup: value.backup,
    ...(pendingSave ? { pendingSave } : {}),
  };
}

export function draftAfterEndedEdit(
  draft: ComposerDraft,
  backup: ComposerDraft,
  originalAttachmentIds: readonly string[],
  changed: boolean,
): { next: ComposerDraft; dropped: DraftAttachment[] } {
  const original = new Set(originalAttachmentIds);
  const added = draft.attachments.filter((attachment) => !original.has(attachment.id));
  if (!changed) return { next: backup, dropped: added };
  const attachments = [...backup.attachments, ...added];
  const before = backup.text.trim();
  return {
    next: {
      text: before ? `${backup.text}\n\n${draft.text}` : draft.text,
      attachments: attachments.slice(0, INPUT_LIMITS.attachments),
      replyToMessageId: before ? backup.replyToMessageId : draft.replyToMessageId,
    },
    dropped: attachments.slice(INPUT_LIMITS.attachments),
  };
}

export function queueEditChanged(
  draft: ComposerDraft,
  originalText: string | undefined,
  originalAttachmentIds: readonly string[],
): boolean {
  const original = new Set(originalAttachmentIds);
  return (
    originalText === undefined ||
    draft.text !== originalText ||
    draft.attachments.length !== originalAttachmentIds.length ||
    draft.attachments.some((attachment) => !original.has(attachment.id))
  );
}

export const THREAD_QUEUE_EDIT_STORAGE_KEY = "openbot:thread-queue-edit";
export interface StoredThreadQueueEdit extends StoredQueueEdit {
  taskId: string;
  draftKey: string;
}

export function readStoredThreadQueueEdit(): StoredThreadQueueEdit | null {
  try {
    return decodeStoredThreadQueueEdit(
      JSON.parse(window.localStorage.getItem(THREAD_QUEUE_EDIT_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}

function decodeStoredThreadQueueEdit(value: unknown): StoredThreadQueueEdit | null {
  const edit = decodeStoredQueueEdit(value);
  if (!edit || !isDynamicRecord(value) || !isString(value.taskId) || !isString(value.draftKey)) return null;
  return { ...edit, taskId: value.taskId, draftKey: value.draftKey };
}

export function storeThreadQueueEdit(edit: StoredThreadQueueEdit): void {
  window.localStorage.setItem(THREAD_QUEUE_EDIT_STORAGE_KEY, JSON.stringify(edit));
}

export function clearStoredThreadQueueEdit(): void {
  try {
    window.localStorage.removeItem(THREAD_QUEUE_EDIT_STORAGE_KEY);
  } catch {}
}

export function rowAttachments(text: string, attachments: readonly DraftAttachment[]): DraftAttachment[] {
  const referencedIds = attachmentReferenceIds(text);
  return attachments.filter((attachment) => attachment.kind === "image" || !referencedIds.has(attachment.id));
}

export function insertAtSelection(
  current: string,
  inserted: string,
  at: { before: string; selection: ComposerSelection } | undefined,
): { value: string; caret: number } {
  const selection = at && current === at.before ? at.selection : undefined;
  if (!selection) {
    const value = [current, inserted].filter(Boolean).join(" ");
    return { value, caret: value.length };
  }
  const value = `${current.slice(0, selection.start)}${inserted}${current.slice(selection.end)}`;
  return { value, caret: selection.start + inserted.length };
}

export function insertPastedText(
  current: string,
  text: string,
  at: { before: string; selection: ComposerSelection } | undefined,
): { value: string; caret: number } | undefined {
  const result = insertAtSelection(current, text, at);
  const over = result.value.length - INPUT_LIMITS.messageText;
  if (over <= 0) return result;
  let end = text.length - over;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end -= 1;
  return end > 0 ? insertAtSelection(current, text.slice(0, end), at) : undefined;
}
