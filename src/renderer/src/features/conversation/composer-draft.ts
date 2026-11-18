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

/**
 * Text that the user did not type, below what the user already typed: a plugin's example question,
 * or a message sent on from another chat.
 *
 * A plugin example carries no reference marker, unlike a skill example: a marker names something the
 * agent must be pointed at, and a plugin's tools are already offered to every agent on this computer.
 * So the example is the question alone.
 */
export function appendDraftText(draft: ComposerDraft, text: string): ComposerDraft {
  const trimmed = text.trim();
  return trimmed ? appendDraftLine(draft, trimmed) : draft;
}

/** One more line in the draft, so an added example never overwrites what the user already typed. */
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
  /** The text of the message when the edit began. An edit stored by an older version has none. */
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
  } catch {
    // Storage is unavailable, so nothing was stored.
  }
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

/**
 * The message box after a queue edit ended before its Save: the message started, or somebody deleted
 * it. A changed edit keeps its text and the files that it added, after the draft from before the
 * edit, so no typed text is lost. An unchanged edit gives back the draft from before the edit, as
 * Cancel does. `dropped` are the added files that the box does not keep, for the caller to discard.
 */
export function draftAfterEndedEdit(
  draft: ComposerDraft,
  backup: ComposerDraft,
  originalAttachmentIds: readonly string[],
  changed: boolean,
): { next: ComposerDraft; dropped: DraftAttachment[] } {
  const original = new Set(originalAttachmentIds);
  // The files of the message belong to it. Only files added during the edit can go in a new message.
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

/** Whether a queue edit changed its message: the text, or the files that it keeps or adds. */
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
/**
 * A queue edit in the message box of a side thread. It has its own record, so it does not take the
 * place of an edit in the agent's own chat. `draftKey` is the thread's `threadDraftKey`.
 */
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

/** Throws when storage is full or unavailable: an edit that cannot be stored must not start. */
export function storeThreadQueueEdit(edit: StoredThreadQueueEdit): void {
  window.localStorage.setItem(THREAD_QUEUE_EDIT_STORAGE_KEY, JSON.stringify(edit));
}

export function clearStoredThreadQueueEdit(): void {
  try {
    window.localStorage.removeItem(THREAD_QUEUE_EDIT_STORAGE_KEY);
  } catch {
    // Storage is unavailable, so nothing was stored.
  }
}

/** The thumbnail row of a message box: each image, also one that the text names, and each other file that the text does not name. */
export function rowAttachments(text: string, attachments: readonly DraftAttachment[]): DraftAttachment[] {
  const referencedIds = attachmentReferenceIds(text);
  return attachments.filter((attachment) => attachment.kind === "image" || !referencedIds.has(attachment.id));
}

/**
 * Puts `inserted` at the selection when the text is still `before`, else at the end. Returns the text
 * and the caret after the inserted text.
 */
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

/**
 * Puts a pasted text in as `insertAtSelection` does. The end of the text that does not fit the message
 * limit is cut, as for a text paste in the editor. Undefined when no part of the text fits.
 */
export function insertPastedText(
  current: string,
  text: string,
  at: { before: string; selection: ComposerSelection } | undefined,
): { value: string; caret: number } | undefined {
  const result = insertAtSelection(current, text, at);
  const over = result.value.length - INPUT_LIMITS.messageText;
  if (over <= 0) return result;
  let end = text.length - over;
  // Do not keep half of a character that has two UTF-16 units, such as an emoji.
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end -= 1;
  return end > 0 ? insertAtSelection(current, text.slice(0, end), at) : undefined;
}
