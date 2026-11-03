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
    draft: value.draft,
    backup: value.backup,
    ...(pendingSave ? { pendingSave } : {}),
  };
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
