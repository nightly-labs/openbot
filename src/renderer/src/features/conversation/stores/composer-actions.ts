import {
  attachmentReferenceIds,
  expandAttachmentReferences,
  rewriteAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import { fileQuoteTarget } from "@openbot/contracts/chat-tag-references";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AttachmentDataInput,
  type DraftAttachment,
  LOCAL_SERVER_ID,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import { TEAM_MESSAGE_CLIENT_ID_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { isQueueEditRejected, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import {
  type ComposerPasteResult,
  type ComposerSelection,
  expandComposerMentions,
} from "@openbot/ui/features/conversation/ComposerEditor";
import { currentText } from "@openbot/ui/text";
import { playActionSound } from "../../../action-sounds";
import { claimDictatedSend, forgetDictatedMessage } from "../../speech/speech-replies";
import { rememberAttachmentKinds } from "../attachment-analytics";
import { type PastedComposerCopy, rememberComposerFile } from "../composer-clipboard";
import { copyComposerDraft, EMPTY_DRAFT, QUEUE_EDIT_STORAGE_KEY, type StoredQueueEdit } from "../composer-draft";
import { composerDraftKey } from "../conversation-keys";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "../conversation-types";
import { conversationOwnerId } from "./composer-store";
import type { PendingSend, PendingSendStore } from "./pending-send-store";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

/** A message that a voice conversation sends. */
export interface VoiceSend {
  /** What the user said, as a draft of this computer. Only the local server keeps it. */
  recordingDraftId: string | undefined;
  /** Called each time the send fails, so the conversation can listen again. */
  onFailed: () => void;
}

export interface ComposerActionsDeps {
  props: ConversationProps;
  agentReady: () => boolean;
  attachmentBusy: () => boolean;
  setAttachmentBusy: (busy: boolean) => void;
  attachmentImports: Map<string, ConversationTarget>;
  drafts: () => Record<string, ComposerDraft>;
  setDrafts: (update: (current: Record<string, ComposerDraft>) => Record<string, ComposerDraft>) => void;
  editingAgentId: () => string | null;
  setEditingAgentId: (id: string | null) => void;
  editingServerId: () => string | null;
  setEditingServerId: (id: string | null) => void;
  editingEditId: () => string | null;
  setEditingEditId: (id: string | null) => void;
  editingDeliveryId: () => string | null;
  setEditingDeliveryId: (id: string | null) => void;
  editingDraftBackup: () => ComposerDraft | null;
  setEditingDraftBackup: (draft: ComposerDraft | null) => void;
  editingOriginalAttachmentIds: () => string[];
  setEditingOriginalAttachmentIds: (ids: string[]) => void;
  editingPendingSave: () => StoredQueueEdit["pendingSave"] | null;
  setEditingPendingSave: (save: StoredQueueEdit["pendingSave"] | null) => void;
  submitting: () => boolean;
  setSubmitting: (submitting: boolean) => void;
  voicePhase: () => string;
  /** The side thread that the recording is for. Undefined for the agent's own chat. */
  voiceThreadKey: () => string | undefined;
  /** `cause` is the failure behind `error`. The banner shows its code. */
  setComposerError: (error: string | null, targetOverride?: ConversationTarget, cause?: unknown) => void;
  setComposerFocusRequest: (update: (current: number) => number) => void;
  setShowComposerActions: (show: boolean) => void;
  orderedQueuedDeliveries: () => QueueDelivery[];
  presentedQueueDeliveries: () => QueueDelivery[];
  typing: {
    idleTimer: ReturnType<typeof setTimeout> | undefined;
    agentId: string | null;
  };
  voice: {
    agentId: string | undefined;
    serverId: string | undefined;
    submitRequest:
      | {
          agentId: string;
          serverId: string;
          draft: ComposerDraft;
          queuedEdit: { deliveryId: string; originalAttachmentIds: string[] } | undefined;
        }
      | undefined;
  };
  stopComposerTyping: () => void;
  stopVoiceRecording: () => void;
  currentTarget: () => ConversationTarget | undefined;
  currentDraft: () => ComposerDraft;
  currentEditingDeliveryId: () => string | null;
  clearConversationError: (target: ConversationTarget) => void;
  clearSubmittedDraft: (target: ConversationTarget, submitted: ComposerDraft) => void;
  setConversationError: (target: ConversationTarget, message: string) => void;
  setStickToLatest: (value: boolean) => void;
  pendingSends: PendingSendStore;
  attachmentPicker: () => HTMLInputElement | undefined;
  /** False in a chat window (#2964): the stored queue edit is one slot, and the main window owns it. */
  persistQueueEdit: boolean;
  /** The open question form of this conversation, which takes the composer text as its answer. */
  promptComposerAnswer: () => QuestionPromptComposerAnswer | undefined;
}

/**
 * Reads pasted files and imports them as draft attachments. Throws when the draft, which has
 * `attached()` files when the files are ready, cannot take them.
 */
export async function importPastedFiles(
  files: ReadonlyArray<File | Promise<File>>,
  attached: () => number,
  importData: (data: AttachmentDataInput[]) => Promise<DraftAttachment[]>,
): Promise<DraftAttachment[]> {
  const originals = await Promise.all(files);
  if (originals.length + attached() > INPUT_LIMITS.attachments)
    throw new Error(t("composer.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
  // Check the sizes before the bytes come into memory, as the path import does.
  if (originals.some((file) => file.size > ATTACHMENT_LIMITS.fileBytes))
    throw new Error(t("error.attachment.fileTooLarge"));
  if (originals.reduce((total, file) => total + file.size, 0) > ATTACHMENT_LIMITS.totalBytes)
    throw new Error(t("error.attachment.totalTooLarge"));
  const data = await Promise.all(
    originals.map(async (file) => ({
      name: file.name,
      mimeType: file.type,
      // A pasted folder has no bytes to read.
      bytes: new Uint8Array(
        await file.arrayBuffer().catch(() => {
          throw new Error(t("error.attachment.unavailable"));
        }),
      ),
    })),
  );
  const imported = await importData(data);
  imported.forEach((attachment, index) => {
    const file = originals[index];
    if (file) rememberComposerFile(attachment, file);
  });
  return imported;
}

export function createComposerActions(deps: ComposerActionsDeps) {
  function storeQueueEdit(edit: StoredQueueEdit): void {
    if (deps.persistQueueEdit) window.localStorage.setItem(QUEUE_EDIT_STORAGE_KEY, JSON.stringify(edit));
  }

  function clearStoredQueueEdit(): void {
    if (deps.persistQueueEdit) window.localStorage.removeItem(QUEUE_EDIT_STORAGE_KEY);
  }

  function updateTeamTyping(text: string): void {
    const agentId = deps.props.agent?.id;
    if (deps.typing.idleTimer) clearTimeout(deps.typing.idleTimer);
    if (!agentId || !text.trim()) {
      stopTeamTyping();
      return;
    }
    if (deps.typing.agentId && deps.typing.agentId !== agentId) deps.props.onTypingChange(deps.typing.agentId, false);
    deps.typing.agentId = agentId;
    deps.props.onTypingChange(agentId, true);
    deps.typing.idleTimer = setTimeout(stopTeamTyping, 3_000);
  }

  function stopTeamTyping(): void {
    deps.stopComposerTyping();
  }

  async function addAttachments(selected: DraftAttachment[], target = deps.currentTarget()) {
    if (!target) return [];
    const pendingSave = deps.editingPendingSave();
    if (
      pendingSave &&
      deps.editingAgentId() === target.agentId &&
      deps.editingServerId() === target.serverId &&
      pendingSave.deliveryId === deps.editingDeliveryId() &&
      pendingSave.editId === deps.editingEditId()
    ) {
      for (const attachment of selected)
        void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, target.serverId);
      deps.setComposerError(t("composer.error.saveUnconfirmed"), target);
      return [];
    }
    deps.clearConversationError(target);
    const key = composerDraftKey(target);
    const draft = deps.drafts()[key] ?? EMPTY_DRAFT;
    const available = Math.max(0, INPUT_LIMITS.attachments - draft.attachments.length);
    const accepted = selected.slice(0, available);
    for (const attachment of selected.slice(available)) {
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, target.serverId);
    }
    const editId = deps.editingEditId();
    const deliveryId = deps.editingDeliveryId();
    if (
      editId &&
      deliveryId &&
      deps.editingAgentId() === target.agentId &&
      deps.editingServerId() === target.serverId &&
      accepted.length
    ) {
      try {
        await conversationRuntime(deps.props).agent.editQueuedMessage(
          {
            agentId: target.agentId,
            deliveryId,
            editId,
            action: "retain-attachments",
            attachmentDraftIds: accepted.map((item) => item.id),
          },
          target.serverId,
        );
        if (deps.editingEditId() !== editId) throw new Error(t("composer.error.editEnded"));
      } catch (error) {
        for (const item of accepted)
          void conversationRuntime(deps.props).agent.discardDraftAttachment(item.id, target.serverId);
        deps.setConversationError(target, errorMessage(error, t("composer.error.keepAttachments")));
        return [];
      }
    }
    const currentDraft = deps.drafts()[key] ?? EMPTY_DRAFT;
    const remaining = Math.max(0, INPUT_LIMITS.attachments - currentDraft.attachments.length);
    for (const item of accepted.splice(remaining))
      void conversationRuntime(deps.props).agent.discardDraftAttachment(item.id, target.serverId);
    deps.setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? EMPTY_DRAFT),
        attachments: [...currentDraft.attachments, ...accepted],
      },
    }));
    if (selected.length > accepted.length)
      deps.setComposerError(t("composer.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }), target);
    deps.setShowComposerActions(false);
    return accepted;
  }

  async function pasteFiles(
    files: ReadonlyArray<File | Promise<File>>,
    selection: ComposerSelection,
    copy?: Pick<PastedComposerCopy, "text" | "sourceIds">,
  ): Promise<ComposerPasteResult | undefined> {
    const target = deps.currentTarget();
    if (!target || deps.submitting()) return;
    const before = deps.currentDraft().text;
    const key = composerDraftKey(target);
    // Puts `text` at the selection. A view can unmount during import, so newer edits stay and the
    // text goes at the end. Returns undefined when the message would be too long.
    const insert = (text: string): ComposerPasteResult | undefined => {
      const current = deps.drafts()[key] ?? EMPTY_DRAFT;
      const next =
        current.text === before
          ? `${before.slice(0, selection.start)}${text}${before.slice(selection.end)}`
          : [current.text, text].filter(Boolean).join(" ");
      if (next.length > INPUT_LIMITS.messageText) return;
      deps.setDrafts((drafts) => ({ ...drafts, [key]: { ...(drafts[key] ?? EMPTY_DRAFT), text: next } }));
      return { value: next, caret: current.text === before ? selection.start + text.length : next.length };
    };
    const requestId = crypto.randomUUID();
    const runtime = conversationRuntime(deps.props);
    deps.attachmentImports.set(requestId, target);
    deps.setAttachmentBusy(true);
    deps.clearConversationError(target);
    try {
      const imported = await importPastedFiles(
        files,
        () => (deps.drafts()[key] ?? EMPTY_DRAFT).attachments.length,
        (data) => runtime.agent.importAttachmentData(data, target.serverId),
      );
      const accepted = await addAttachments(imported, target);
      // The draft refused the files and shows why. The text of a copy still comes, with their names.
      if (!accepted.length) return copy?.text ? insert(expandAttachmentReferences(copy.text)) : undefined;
      const replacements = new Map((copy?.sourceIds ?? []).map((id, index) => [id, accepted[index]]));
      const text =
        copy === undefined
          ? accepted.map((attachment) => serializeAttachmentReference(attachment.name, attachment.id)).join(" ")
          : rewriteAttachmentReferences(copy.text, (reference) => {
              const attachment = replacements.get(reference.attachmentId);
              return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
            });
      const result = insert(text);
      // The files stay in the row, so a paste that does not fit loses no file.
      if (!result) throw new Error(t("error.agent.messageTooLong"));
      return result;
    } catch (error) {
      deps.setConversationError(target, errorMessage(error, t("composer.error.keepAttachments")));
      // When the files of a copy cannot come, its text comes with their names, as in another app.
      return copy?.text ? insert(expandAttachmentReferences(copy.text)) : undefined;
    } finally {
      deps.attachmentImports.delete(requestId);
      deps.setAttachmentBusy(deps.attachmentImports.size > 0);
    }
  }

  /**
   * A cut moves its files with the text. The draft drops each one that `remaining` no longer names, and
   * discards it after the copy has read its bytes. A file that the copy could not read comes back. A
   * pending Save keeps its attachments, as in removal.
   */
  function releaseCutAttachments(
    attachments: readonly DraftAttachment[],
    remaining: string,
    copied: Promise<ReadonlySet<string>>,
  ): void {
    const target = deps.currentTarget();
    if (!target) return;
    if (
      deps.editingPendingSave() &&
      deps.editingAgentId() === target.agentId &&
      deps.editingServerId() === target.serverId &&
      deps.editingDeliveryId()
    )
      return;
    const key = composerDraftKey(target);
    // The draft can still hold the text from before the cut: Solid batches the write.
    const referenced = attachmentReferenceIds(remaining);
    const released = new Set(attachments.map((attachment) => attachment.id).filter((id) => !referenced.has(id)));
    if (!released.size) return;
    deps.setDrafts((drafts) => {
      const draft = drafts[key] ?? EMPTY_DRAFT;
      return {
        ...drafts,
        [key]: { ...draft, attachments: draft.attachments.filter((attachment) => !released.has(attachment.id)) },
      };
    });
    const runtime = conversationRuntime(deps.props);
    void copied.then((read) => {
      // A file that the copy could not read goes back to the draft, so the cut loses no file.
      const unread = attachments.filter((attachment) => released.has(attachment.id) && !read.has(attachment.id));
      if (unread.length)
        deps.setDrafts((drafts) => {
          const draft = drafts[key] ?? EMPTY_DRAFT;
          const present = new Set(draft.attachments.map((attachment) => attachment.id));
          const restored = unread.filter((attachment) => !present.has(attachment.id));
          return { ...drafts, [key]: { ...draft, attachments: [...draft.attachments, ...restored] } };
        });
      for (const id of released)
        if (read.has(id)) void runtime.agent.discardDraftAttachment(id, target.serverId).catch(() => {});
    });
  }

  function openAttachmentPicker() {
    deps.setShowComposerActions(false);
    deps.setComposerError(null, deps.currentTarget());
    const picker = deps.attachmentPicker();
    if (!picker) return;
    picker.value = "";
    picker.click();
  }

  async function editQueuedMessage(delivery: QueueDelivery) {
    const agentId = deps.props.agent?.id;
    const serverId = deps.props.server?.id ?? "local";
    if (!agentId || delivery.status !== "queued" || deps.submitting()) return;
    // A pending Save owns the outcome: keep it for retry instead of replacing it.
    if (deps.editingPendingSave()) return;
    if (deps.editingDeliveryId() && !(await cancelQueuedMessageEdit())) return;
    if (deps.props.agent?.id !== agentId || (deps.props.server?.id ?? "local") !== serverId) return;
    const backup = copyComposerDraft(deps.currentDraft());
    const supportsHold =
      deps.props.server?.kind !== "remote" ||
      Boolean(deps.props.server.compatibility?.capabilities.includes(TEAM_QUEUE_EDIT_CAPABILITY));
    const editId = supportsHold ? crypto.randomUUID() : null;
    const setEditingDraft = (original: QueueDelivery) => {
      deps.setEditingAgentId(agentId);
      deps.setEditingServerId(serverId);
      deps.setEditingDraftBackup(backup);
      deps.setEditingOriginalAttachmentIds(original.attachments.map((attachment) => attachment.id));
      deps.setEditingDeliveryId(original.id);
      deps.setEditingEditId(editId);
      deps.setEditingPendingSave(null);
      deps.setDrafts((current) => ({
        ...current,
        [composerDraftKey({ agentId, serverId })]: {
          text: original.text,
          attachments: [...original.attachments],
          replyToMessageId: original.replyToMessageId,
        },
      }));
    };
    deps.setSubmitting(true);
    try {
      if (editId)
        storeQueueEdit({
          agentId,
          serverId,
          deliveryId: delivery.id,
          editId,
          originalAttachmentIds: delivery.attachments.map((item) => item.id),
          backup,
          draft: {
            text: delivery.text,
            attachments: delivery.attachments,
            replyToMessageId: delivery.replyToMessageId,
          },
        });
      // Record ownership before the request: a lost response must not free this editor slot.
      setEditingDraft(delivery);
      if (editId) {
        const held = await conversationRuntime(deps.props).agent.editQueuedMessage(
          { agentId, action: "begin", deliveryId: delivery.id, editId },
          serverId,
        );
        const original = held.deliveries.find((item) => item.id === delivery.id);
        if (!original) throw new Error(t("composer.error.queuedUnavailable"));
        if (backup.attachments.length) {
          // Keep the same recovery identity if retention fails. Save retries retention;
          // Cancel uses the normal confirmed-release path.
          await conversationRuntime(deps.props).agent.editQueuedMessage(
            {
              agentId,
              action: "retain-attachments",
              deliveryId: delivery.id,
              editId,
              attachmentDraftIds: backup.attachments.map((attachment) => attachment.id),
            },
            serverId,
          );
        }
        setEditingDraft(original);
      }
    } catch (error) {
      deps.setComposerError(
        errorMessage(error, t("composer.error.holdQueued")),
        {
          agentId,
          serverId,
        },
        error,
      );
      return;
    } finally {
      deps.setSubmitting(false);
    }
    deps.clearConversationError({ agentId, serverId });
    deps.setComposerFocusRequest((current) => current + 1);
    deps.setShowComposerActions(false);
    deps.setComposerError(null, { agentId, serverId });
  }

  async function cancelQueuedMessageEdit() {
    if (deps.submitting()) return false;
    const agentId = deps.editingAgentId() ?? deps.props.agent?.id;
    const serverId = deps.editingServerId() ?? deps.props.server?.id ?? "local";
    const target = agentId ? { agentId, serverId } : undefined;
    const editId = deps.editingEditId();
    const deliveryId = deps.editingDeliveryId();
    const queue = deps.props.queue;
    const unavailable =
      target &&
      deps.currentEditingDeliveryId() === deliveryId &&
      queue?.agentId === target.agentId &&
      queue.deliveries.find((item) => item.id === deliveryId)?.status !== "queued";
    if (target && editId && deliveryId && !unavailable) {
      deps.setSubmitting(true);
      try {
        await conversationRuntime(deps.props).agent.editQueuedMessage(
          { agentId: target.agentId, action: "cancel", deliveryId, editId },
          serverId,
        );
      } catch (error) {
        if (!isQueueEditRejected(error)) {
          deps.setComposerError(errorMessage(error, t("composer.error.cancelEdit")), target, error);
          return false;
        }
      } finally {
        deps.setSubmitting(false);
      }
    }
    const backup = deps.editingDraftBackup();
    const draft = target ? (deps.drafts()[composerDraftKey(target)] ?? EMPTY_DRAFT) : EMPTY_DRAFT;
    const preservedAttachmentIds = new Set([
      ...(backup?.attachments.map((attachment) => attachment.id) ?? []),
      ...deps.editingOriginalAttachmentIds(),
    ]);
    for (const attachment of draft.attachments) {
      if (!preservedAttachmentIds.has(attachment.id)) {
        void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
      }
    }
    if (target) {
      deps.setDrafts((current) => ({ ...current, [composerDraftKey(target)]: backup ?? EMPTY_DRAFT }));
      deps.setComposerError(null, target);
    }
    deps.setEditingAgentId(null);
    deps.setEditingServerId(null);
    deps.setEditingDeliveryId(null);
    deps.setEditingEditId(null);
    deps.setEditingPendingSave(null);
    clearStoredQueueEdit();
    deps.setEditingDraftBackup(null);
    deps.setEditingOriginalAttachmentIds([]);
    return true;
  }

  async function saveQueuedMessageEdit(
    draftOverride?: ComposerDraft,
    target?: ConversationTarget & { deliveryId: string; originalAttachmentIds: string[] },
    submittedSnapshot?: ComposerDraft,
  ): Promise<boolean> {
    const agentId = target?.agentId ?? deps.editingAgentId() ?? deps.props.agent?.id;
    const serverId = target?.serverId ?? deps.editingServerId() ?? deps.props.server?.id ?? "local";
    const deliveryId = target?.deliveryId ?? deps.editingDeliveryId();
    const draft = draftOverride ?? deps.currentDraft();
    if (!agentId || !deliveryId || deps.submitting() || deps.attachmentBusy()) return false;
    const editId = deps.editingEditId();
    if (
      !editId &&
      !target &&
      deps.props.queue?.deliveries.find((item) => item.id === deliveryId)?.status !== "queued"
    ) {
      deps.setComposerError(t("composer.error.queuedUnavailable"), { agentId, serverId });
      return false;
    }
    // A lost Save response leaves the exact request durable. Retry it instead of
    // rebuilding from the draft, so a changed text cannot fail the host check.
    const storedPending = deps.editingPendingSave();
    const hasPending =
      Boolean(editId) &&
      storedPending?.action === "save" &&
      storedPending.deliveryId === deliveryId &&
      storedPending.editId === editId &&
      deps.editingAgentId() === agentId &&
      deps.editingServerId() === serverId;
    let text: string;
    let keepAttachmentIds: string[];
    let attachmentDraftIds: string[];
    if (hasPending && storedPending?.action === "save") {
      text = storedPending.text;
      keepAttachmentIds = storedPending.keepAttachmentIds;
      attachmentDraftIds = storedPending.attachmentDraftIds;
    } else {
      text = expandComposerMentions(draft.text);
      const originalAttachmentIds = new Set(target?.originalAttachmentIds ?? deps.editingOriginalAttachmentIds());
      keepAttachmentIds = draft.attachments
        .filter((attachment) => originalAttachmentIds.has(attachment.id))
        .map((attachment) => attachment.id);
      attachmentDraftIds = draft.attachments
        .filter((attachment) => !originalAttachmentIds.has(attachment.id))
        .map((attachment) => attachment.id);
      if (!text.trim() && keepAttachmentIds.length === 0 && attachmentDraftIds.length === 0) return false;
    }

    stopTeamTyping();
    deps.setSubmitting(true);
    deps.setComposerError(null, { agentId, serverId });
    // A Begin that never reached the host leaves an identity with no hold. Saving it
    // would be rejected and then lock the editor behind pendingSave with no recovery,
    // so confirm the hold with the same identity first. Retries skip this: the host
    // answers the stored request from its finished-save record without needing Begin.
    if (editId && !hasPending) {
      try {
        const held = await conversationRuntime(deps.props).agent.editQueuedMessage(
          { agentId, action: "begin", deliveryId, editId },
          serverId,
        );
        if (!held.deliveries.some((item) => item.id === deliveryId))
          throw new Error(t("composer.error.queuedUnavailable"));
        const backupAttachments = (deps.editingDraftBackup()?.attachments ?? []).map((attachment) => attachment.id);
        if (backupAttachments.length) {
          await conversationRuntime(deps.props).agent.editQueuedMessage(
            { agentId, action: "retain-attachments", deliveryId, editId, attachmentDraftIds: backupAttachments },
            serverId,
          );
        }
      } catch (error) {
        deps.setSubmitting(false);
        deps.setComposerError(
          errorMessage(error, t("composer.error.holdQueued")),
          {
            agentId,
            serverId,
          },
          error,
        );
        return false;
      }
      const pendingSave = {
        action: "save" as const,
        deliveryId,
        editId,
        text,
        keepAttachmentIds,
        attachmentDraftIds,
      };
      // Persist the exact request before sending: a lost response must stay retryable.
      deps.setEditingPendingSave(pendingSave);
      try {
        storeQueueEdit({
          agentId,
          serverId,
          deliveryId,
          editId,
          originalAttachmentIds: target?.originalAttachmentIds ?? deps.editingOriginalAttachmentIds(),
          backup: deps.editingDraftBackup() ?? EMPTY_DRAFT,
          draft,
          pendingSave,
        });
      } catch (error) {
        deps.setEditingPendingSave(null);
        deps.setSubmitting(false);
        deps.setComposerError(t("composer.error.saveEditTryAgain"), { agentId, serverId }, error);
        return false;
      }
    }

    let saved = false;
    try {
      if (editId) {
        await conversationRuntime(deps.props).agent.editQueuedMessage(
          { agentId, action: "save", deliveryId, editId, text, keepAttachmentIds, attachmentDraftIds },
          serverId,
        );
        saved = true;
      } else {
        saved = await deps.props.onUpdateQueuedMessage(deliveryId, text, keepAttachmentIds, attachmentDraftIds, {
          agentId,
          serverId,
        });
      }
    } catch (error) {
      deps.setComposerError(
        errorMessage(error, t("composer.error.updateQueued")),
        {
          agentId,
          serverId,
        },
        error,
      );
    } finally {
      deps.setSubmitting(false);
    }
    if (!saved) return false;
    const savedTarget = { agentId, serverId };
    deps.clearConversationError(savedTarget);
    if (submittedSnapshot) deps.clearSubmittedDraft(savedTarget, submittedSnapshot);
    else deps.setDrafts((current) => ({ ...current, [composerDraftKey(savedTarget)]: EMPTY_DRAFT }));
    if (
      deps.editingAgentId() === agentId &&
      deps.editingServerId() === serverId &&
      deps.editingDeliveryId() === deliveryId
    ) {
      // Save consumes the edited draft and abandons its composer backup. Explicitly
      // discard those files: a backup restored by an earlier Cancel survives restart.
      for (const attachment of deps.editingDraftBackup()?.attachments ?? []) {
        void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
      }
      deps.setEditingAgentId(null);
      deps.setEditingServerId(null);
      deps.setEditingDeliveryId(null);
      deps.setEditingEditId(null);
      deps.setEditingPendingSave(null);
      clearStoredQueueEdit();
      deps.setEditingDraftBackup(null);
      deps.setEditingOriginalAttachmentIds([]);
    }
    return true;
  }

  function reorderPresentedQueue(deliveryIds: string[]) {
    const allQueuedIds = deps.orderedQueuedDeliveries().map((delivery) => delivery.id);
    const presentedQueuedIds = deps
      .presentedQueueDeliveries()
      .filter((delivery) => delivery.status === "queued")
      .map((delivery) => delivery.id);
    if (presentedQueuedIds.length === allQueuedIds.length) {
      deps.props.onReorderQueue(deliveryIds);
      return;
    }

    const presentedIds = new Set(presentedQueuedIds);
    let nextPresentedIndex = 0;
    deps.props.onReorderQueue(
      allQueuedIds.map((deliveryId) =>
        presentedIds.has(deliveryId) ? (deliveryIds[nextPresentedIndex++] ?? deliveryId) : deliveryId,
      ),
    );
  }

  /**
   * While the agent asks a question, the composer text answers it and does not steer the turn. Files,
   * a reply to a message and a queued message edit still go as a message. A channel message is for
   * the whole channel, so it does not answer one agent.
   */
  function promptAnswerFor(
    draft: ComposerDraft,
    target: ConversationTarget | undefined,
  ): QuestionPromptComposerAnswer | undefined {
    const answer = deps.promptComposerAnswer();
    const active = deps.currentTarget();
    if (deps.props.channel || !answer?.available() || !target || !active) return undefined;
    if (target.agentId !== active.agentId || target.serverId !== active.serverId) return undefined;
    if (draft.attachments.length > 0 || draft.replyToMessageId) return undefined;
    return answer;
  }

  /** Whether a send from the composer now answers the open question. */
  function composerAnswersPrompt(): boolean {
    return !deps.currentEditingDeliveryId() && Boolean(promptAnswerFor(deps.currentDraft(), deps.currentTarget()));
  }

  /** `voice` is set when a voice conversation sends the draft. `steer` takes it into the running turn. */
  async function submitMessage(
    draftOverride?: ComposerDraft,
    targetOverride?: ConversationTarget,
    submittedSnapshot?: ComposerDraft,
    voice?: VoiceSend,
    steer = false,
  ): Promise<boolean> {
    if (deps.attachmentBusy()) return false;
    if (!draftOverride && deps.currentEditingDeliveryId()) {
      return saveQueuedMessageEdit();
    }
    const agentId = targetOverride?.agentId ?? conversationOwnerId(deps.props);
    const target = targetOverride ?? (agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined);
    const draft = copyComposerDraft(draftOverride ?? deps.currentDraft());
    const text = expandComposerMentions(draft.text);
    const promptAnswer = promptAnswerFor(draft, target);
    if (promptAnswer && target) {
      if (deps.submitting() || !promptAnswer.answer(text)) return false;
      // An answer is not a message, so no spoken reply or voice recording belongs to it.
      if (claimDictatedSend(target)) forgetDictatedMessage(target);
      if (voice?.recordingDraftId)
        void conversationRuntime(deps.props)
          .agent.discardDraftAttachment(voice.recordingDraftId, LOCAL_SERVER_ID)
          .catch(() => {});
      stopTeamTyping();
      deps.setComposerError(null, target);
      deps.clearConversationError(target);
      deps.clearSubmittedDraft(target, submittedSnapshot ?? draft);
      return true;
    }
    if (!agentId || !target || deps.submitting() || (!text.trim() && draft.attachments.length === 0)) return false;
    const provider =
      deps.props.agent?.id === agentId
        ? deps.props.agent.provider
        : deps.props.agents.find((agent) => agent.id === agentId)?.provider;
    if (
      target.serverId === (deps.props.server?.id ?? LOCAL_SERVER_ID) &&
      deps.props.agentStatus.providers?.some((status) => status.id === provider && status.state === "outdated")
    )
      return false;
    stopTeamTyping();
    deps.setComposerError(null, target);
    deps.clearConversationError(target);
    queueSend(target, draft, text, voice, steer);
    deps.clearSubmittedDraft(target, submittedSnapshot ?? draft);
    return true;
  }

  /**
   * Shows a message at once and sends it after the earlier sends of its chat, so the host stores the
   * chat's messages in the order the user sent them. `draft` is what Edit puts back in the composer.
   */
  function queueSend(
    target: ConversationTarget,
    draft: ComposerDraft,
    text: string,
    voice?: VoiceSend,
    steer = false,
  ): void {
    const onScreen = () => {
      const activeTarget = deps.currentTarget();
      return activeTarget?.agentId === target.agentId && activeTarget.serverId === target.serverId;
    };
    if (onScreen()) deps.setStickToLatest(true);
    // A message to a working agent waits behind its turn or its queue. A channel has no such queue.
    // An earlier send that has not failed is about to start a turn, so this one waits behind it.
    const queued =
      onScreen() &&
      !deps.props.channel &&
      (Boolean(deps.props.activeTurnId) ||
        deps.orderedQueuedDeliveries().length > 0 ||
        deps.pendingSends.list(target).some((send) => send.state !== "failed"));
    // Read the send functions now: the send outlives this view when the user switches server.
    const send = deps.props.onSendMessage;
    const steerQueued = deps.props.onSteerQueuedMessage;
    const server = deps.props.server;
    // A deferred voice send can name a server that is no longer on screen. Its capabilities are not
    // known here, so only the local host, which always drops a repeat, is safe to retry then.
    const retrySafe =
      target.serverId === LOCAL_SERVER_ID ||
      (server?.id === target.serverId &&
        (server.kind !== "remote" ||
          Boolean(server.compatibility?.capabilities.includes(TEAM_MESSAGE_CLIENT_ID_CAPABILITY))));
    const voiceRecordingDraftId = voice?.recordingDraftId ?? null;
    const dictatedSent = claimDictatedSend(target);
    deps.pendingSends.add(target, { draft, text, retrySafe, voiceRecordingDraftId, queued }, async (pending) => {
      rememberAttachmentKinds(pending.draft.attachments);
      const result = await send(
        pending.text,
        pending.draft.attachments.map((item) => item.id),
        pending.draft.replyToMessageId,
        target,
        pending.clientMessageId,
        pending.voiceRecordingDraftId ?? undefined,
      );
      if ("error" in result) {
        playActionSound("error");
        voice?.onFailed();
      } else {
        dictatedSent?.(result.messageId);
        // The id is the delivery's. Steer acts on the chat on screen, so not after a switch.
        if (steer && onScreen()) steerQueued(result.messageId);
      }
      return result;
    });
  }

  function retryPendingSend(clientMessageId: string): void {
    const target = deps.currentTarget();
    if (target) deps.pendingSends.retry(target, clientMessageId);
  }

  /** Puts a failed message back in the composer. The composer must be empty, so nothing is lost. */
  function editPendingSend(clientMessageId: string): void {
    const target = deps.currentTarget();
    if (!target || deps.currentEditingDeliveryId()) return;
    const current = deps.currentDraft();
    if (current.text.trim() || current.attachments.length > 0) return;
    const removed = deps.pendingSends.remove(target, clientMessageId);
    if (!removed) return;
    discardVoiceRecording(removed);
    deps.setDrafts((drafts) => ({ ...drafts, [composerDraftKey(target)]: removed.draft }));
    deps.setComposerFocusRequest((value) => value + 1);
  }

  function dismissPendingSend(clientMessageId: string): void {
    const target = deps.currentTarget();
    if (!target) return;
    const removed = deps.pendingSends.remove(target, clientMessageId);
    // A send whose answer was lost may have stored the files already; the host ignores those ids.
    for (const attachment of removed?.draft.attachments ?? [])
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, target.serverId);
    if (removed) discardVoiceRecording(removed);
  }

  /** A voice recording is always a draft of this computer, whichever server the message was for. */
  function discardVoiceRecording(send: PendingSend): void {
    if (send.voiceRecordingDraftId)
      void conversationRuntime(deps.props)
        .agent.discardDraftAttachment(send.voiceRecordingDraftId, LOCAL_SERVER_ID)
        .catch(() => {});
  }

  function submitComposer(): void {
    if (deps.attachmentBusy()) return;
    const phase = deps.voicePhase();
    // A recording for a side thread sends to that thread, not to this message box.
    if (phase === "recording" && deps.voiceThreadKey() === undefined) {
      const agentId = deps.voice.agentId;
      const serverId = deps.voice.serverId;
      if (!agentId || !serverId) return;
      const target = { agentId, serverId };
      const draft = copyComposerDraft(deps.drafts()[composerDraftKey(target)] ?? EMPTY_DRAFT);
      const deliveryId =
        deps.editingAgentId() === agentId && deps.editingServerId() === serverId ? deps.editingDeliveryId() : null;
      const activeTarget = deps.currentTarget();
      const targetIsActive = activeTarget?.agentId === target.agentId && activeTarget.serverId === target.serverId;
      const delivery =
        deliveryId && targetIsActive ? deps.props.queue?.deliveries.find((item) => item.id === deliveryId) : undefined;
      if (deliveryId && targetIsActive && !deps.editingEditId() && delivery?.status !== "queued") {
        deps.setComposerError(t("composer.error.queuedUnavailable"), target);
        void cancelQueuedMessageEdit();
        return;
      }
      deps.voice.submitRequest = {
        agentId,
        serverId,
        draft,
        queuedEdit: deliveryId
          ? {
              deliveryId,
              originalAttachmentIds: delivery
                ? delivery.attachments.map((attachment) => attachment.id)
                : [...deps.editingOriginalAttachmentIds()],
            }
          : undefined,
      };
      deps.stopVoiceRecording();
      return;
    }
    // The editor stays open while the agent starts, but a send waits until it is ready.
    if (phase !== "idle" || !deps.agentReady()) return;
    void submitMessage();
  }

  /**
   * Sends the draft into the running turn: Send, then Steer on its queue row, in one key. An agent
   * that steers each message sent while it works does that itself, so a second steer is not asked.
   */
  function steerComposer(): void {
    if (deps.attachmentBusy() || deps.voicePhase() !== "idle" || !deps.agentReady()) return;
    const hostSteers = (deps.props.agent?.busyMessageMode ?? deps.props.defaultBusyMessageMode) === "steer";
    void submitMessage(undefined, undefined, undefined, undefined, !hostSteers);
  }

  /** An instruction about selected text is a reply to that message. A failure shows on its row. */
  async function sendSelectionInstruction(messageId: string, body: string): Promise<boolean> {
    const target = deps.currentTarget();
    if (!target || deps.submitting() || !deps.agentReady()) return false;
    // A file passage is in the body as a quote tag; only a message passage makes a reply.
    const replyToMessageId = fileQuoteTarget(messageId) ? null : messageId;
    queueSend(target, { text: body, attachments: [], replyToMessageId }, body);
    return true;
  }

  /** A message that a card in the chat sends for the user, such as Continue after a sign-in. */
  function sendCardMessage(body: string): boolean {
    const target = deps.currentTarget();
    if (!target || deps.submitting() || !deps.agentReady()) return false;
    queueSend(target, { text: body, attachments: [], replyToMessageId: null }, body);
    return true;
  }

  return {
    updateTeamTyping,
    stopTeamTyping,
    addAttachments,
    pasteFiles,
    releaseCutAttachments,
    openAttachmentPicker,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    saveQueuedMessageEdit,
    reorderPresentedQueue,
    submitMessage,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    sendSelectionInstruction,
    sendCardMessage,
    retryPendingSend,
    editPendingSend,
    dismissPendingSend,
  };
}
