import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { isAttachmentSummary, type MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeQueueEditRequest, type QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
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
    `${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt?.trim() || "Help me use this skill."}`,
  );
}

export function appendSkillCreationRequest(draft: ComposerDraft): ComposerDraft {
  return appendDraftLine(
    draft,
    "Help me create a new local skill. Use the skill-creation guide. Ask me what workflow it should support before you create it.",
  );
}

/**
 * A plugin's example question, written as the user would have typed it.
 *
 * It carries no reference marker, unlike a skill example: a marker names something the agent must
 * be pointed at, and a plugin's tools are already offered to every agent on this computer. So the
 * example is the question alone.
 */
export function appendPluginPrompt(draft: ComposerDraft, prompt: string): ComposerDraft {
  const text = prompt.trim();
  return text ? appendDraftLine(draft, text) : draft;
}

/** One more line in the draft, so an added example never overwrites what the user already typed. */
function appendDraftLine(draft: ComposerDraft, line: string): ComposerDraft {
  return { ...draft, text: draft.text ? `${draft.text}\n${line}` : line };
}

export const QUEUE_EDIT_STORAGE_KEY = "openbot:queue-edit";
export type StoredQueueSave = Extract<QueueEditRequest, { action: "save" }>;
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
