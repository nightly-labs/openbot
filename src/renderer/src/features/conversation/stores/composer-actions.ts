import { agentSteersTurns } from "@openbot/contracts/agent-providers";
import { rasterImageMimeType } from "@openbot/contracts/attachment-files";
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
import {
  copyComposerDraft,
  draftAfterEndedEdit,
  EMPTY_DRAFT,
  insertAtSelection,
  insertPastedText,
  QUEUE_EDIT_STORAGE_KEY,
  queueEditChanged,
  type StoredQueueEdit,
} from "../composer-draft";
import { composerDraftKey } from "../conversation-keys";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "../conversation-types";
import { conversationOwnerId } from "./composer-store";
import type { PendingSend, PendingSendStore } from "./pending-send-store";

const { t, errorMessage } = currentText();

export interface VoiceSend {
  recordingDraftId: string | undefined;
  onFailed: () => void;
}

export interface PastePreview {
  id: string;
  draftKey: string;
  name: string;
  url: string;
}

const PASTE_PREVIEW_DELAY_MS = 150;

async function readPastePreviews(files: readonly File[], draftKey: string): Promise<PastePreview[]> {
  const previews = await Promise.all(
    files.map(async (file) => {
      const type = rasterImageMimeType(file.name);
      if (!type) return null;
      const url = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(new Blob([file], { type }));
      });
      return url ? { id: crypto.randomUUID(), draftKey, name: file.name, url } : null;
    }),
  );
  return previews.filter((preview) => preview !== null);
}

type SetPastePreviews = (update: (current: readonly PastePreview[]) => readonly PastePreview[]) => void;

export function pastePreviewTracker(draftKey: string, setPastePreviews: SetPastePreviews) {
  let importing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ids = new Set<string>();
  return {
    onAccepted(files: readonly File[]): void {
      timer = setTimeout(() => {
        void readPastePreviews(files, draftKey).then((ready) => {
          if (!importing || ready.length === 0) return;
          for (const preview of ready) ids.add(preview.id);
          setPastePreviews((current) => [...current, ...ready]);
        });
      }, PASTE_PREVIEW_DELAY_MS);
    },
    stop(): void {
      importing = false;
      clearTimeout(timer);
      if (ids.size) setPastePreviews((current) => current.filter((preview) => !ids.has(preview.id)));
    },
  };
}

export interface ComposerActionsDeps {
  props: ConversationProps;
  agentReady: () => boolean;
  attachmentBusy: (target?: ConversationTarget) => boolean;
  uploadFailed: () => boolean;
  syncAttachmentImports: () => void;
  setPastePreviews: SetPastePreviews;
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
  voiceThreadKey: () => string | undefined;
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
  followSentMessage: () => void;
  pendingSends: PendingSendStore;
  attachmentPicker: () => HTMLInputElement | undefined;
  persistQueueEdit: boolean;
  promptComposerAnswer: () => QuestionPromptComposerAnswer | undefined;
}

export async function importPastedFiles(
  files: ReadonlyArray<File | Promise<File>>,
  attached: () => number,
  importData: (data: AttachmentDataInput[]) => Promise<DraftAttachment[]>,
  onAccepted?: (files: readonly File[]) => void,
): Promise<DraftAttachment[]> {
  const originals = await Promise.all(files);
  if (originals.length + attached() > INPUT_LIMITS.attachments)
    throw new Error(t("composer.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
  if (originals.some((file) => file.size > ATTACHMENT_LIMITS.fileBytes))
    throw new Error(t("error.attachment.fileTooLarge"));
  if (originals.reduce((total, file) => total + file.size, 0) > ATTACHMENT_LIMITS.totalBytes)
    throw new Error(t("error.attachment.totalTooLarge"));
  onAccepted?.(originals);
  const data = await Promise.all(
    originals.map(async (file) => ({
      name: file.name,
      mimeType: file.type,
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
    text?: string,
  ): Promise<ComposerPasteResult | undefined> {
    const target = deps.currentTarget();
    if (!target || deps.submitting()) return;
    const before = deps.currentDraft().text;
    const key = composerDraftKey(target);
    const insert = (text: string): ComposerPasteResult | undefined => {
      const result = insertAtSelection((deps.drafts()[key] ?? EMPTY_DRAFT).text, text, { before, selection });
      if (result.value.length > INPUT_LIMITS.messageText) return;
      deps.setDrafts((drafts) => ({ ...drafts, [key]: { ...(drafts[key] ?? EMPTY_DRAFT), text: result.value } }));
      return result;
    };
    const fallback = (): ComposerPasteResult | undefined => {
      if (copy?.text) return insert(expandAttachmentReferences(copy.text));
      if (text === undefined) return;
      const result = insertPastedText((deps.drafts()[key] ?? EMPTY_DRAFT).text, text, { before, selection });
      if (result)
        deps.setDrafts((drafts) => ({ ...drafts, [key]: { ...(drafts[key] ?? EMPTY_DRAFT), text: result.value } }));
      return result;
    };
    const requestId = crypto.randomUUID();
    const runtime = conversationRuntime(deps.props);
    deps.attachmentImports.set(requestId, target);
    deps.syncAttachmentImports();
    deps.clearConversationError(target);
    const previews = pastePreviewTracker(key, deps.setPastePreviews);
    try {
      const imported = await importPastedFiles(
        files,
        () => (deps.drafts()[key] ?? EMPTY_DRAFT).attachments.length,
        (data) => runtime.agent.importAttachmentData(data, target.serverId),
        previews.onAccepted,
      );
      const accepted = await addAttachments(imported, target);
      if (!accepted.length) return fallback();
      const replacements = new Map((copy?.sourceIds ?? []).map((id, index) => [id, accepted[index]]));
      const inserted =
        copy === undefined
          ? accepted.map((attachment) => serializeAttachmentReference(attachment.name, attachment.id)).join(" ")
          : rewriteAttachmentReferences(copy.text, (reference) => {
              const attachment = replacements.get(reference.attachmentId);
              return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
            });
      const result = insert(inserted);
      if (result) return result;
      if (text === undefined) throw new Error(t("error.agent.messageTooLong"));
      deps.setConversationError(target, t("error.agent.messageTooLong"));
      return;
    } catch (error) {
      deps.setConversationError(target, errorMessage(error, t("composer.error.keepAttachments")));
      return fallback();
    } finally {
      previews.stop();
      deps.attachmentImports.delete(requestId);
      deps.syncAttachmentImports();
    }
  }

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
      setEditingDraft(delivery);
      if (editId) {
        const held = await conversationRuntime(deps.props).agent.editQueuedMessage(
          { agentId, action: "begin", deliveryId: delivery.id, editId },
          serverId,
        );
        const original = held.deliveries.find((item) => item.id === delivery.id);
        if (!original) throw new Error(t("composer.error.queuedUnavailable"));
        if (backup.attachments.length) {
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
    clearQueueEditState();
    return true;
  }

  function endQueuedMessageEdit(ended: QueueDelivery | null): void {
    const agentId = deps.editingAgentId();
    const serverId = deps.editingServerId();
    if (!agentId || !serverId || (ended && deps.editingDeliveryId() !== ended.id)) return;
    const target = { agentId, serverId };
    const draft = deps.drafts()[composerDraftKey(target)] ?? EMPTY_DRAFT;
    const gone = new Set(deps.editingPendingSave()?.attachmentDraftIds ?? []);
    const changed =
      !ended ||
      queueEditChanged(
        draft,
        ended.text,
        ended.attachments.map((attachment) => attachment.id),
      );
    const { next, dropped } = draftAfterEndedEdit(
      { ...draft, attachments: draft.attachments.filter((attachment) => !gone.has(attachment.id)) },
      deps.editingDraftBackup() ?? EMPTY_DRAFT,
      deps.editingOriginalAttachmentIds(),
      changed,
    );
    for (const attachment of dropped)
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
    deps.setDrafts((current) => ({ ...current, [composerDraftKey(target)]: next }));
    clearQueueEditState();
    const deleted = ended?.status === "cancelled";
    if (deleted && !changed) deps.setComposerError(null, target);
    else
      deps.setComposerError(
        t(
          !ended
            ? "composer.queueEdit.endedKept"
            : deleted
              ? "composer.queueEdit.deletedKept"
              : changed
                ? "composer.queueEdit.receivedKept"
                : "composer.queueEdit.received",
        ),
        target,
      );
  }

  function clearQueueEditState(): void {
    deps.setEditingAgentId(null);
    deps.setEditingServerId(null);
    deps.setEditingDeliveryId(null);
    deps.setEditingEditId(null);
    deps.setEditingPendingSave(null);
    clearStoredQueueEdit();
    deps.setEditingDraftBackup(null);
    deps.setEditingOriginalAttachmentIds([]);
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
    if (!agentId || !deliveryId || deps.submitting() || deps.attachmentBusy({ agentId, serverId })) return false;
    const editId = deps.editingEditId();
    if (
      !editId &&
      !target &&
      deps.props.queue?.deliveries.find((item) => item.id === deliveryId)?.status !== "queued"
    ) {
      deps.setComposerError(t("composer.error.queuedUnavailable"), { agentId, serverId });
      return false;
    }
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
        if (isQueueEditRejected(error) && deps.editingDeliveryId() === deliveryId) {
          endQueuedMessageEdit(null);
          return false;
        }
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
      if (editId && isQueueEditRejected(error) && deps.editingDeliveryId() === deliveryId) endQueuedMessageEdit(null);
      else
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
      for (const attachment of deps.editingDraftBackup()?.attachments ?? []) {
        void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
      }
      clearQueueEditState();
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

  function composerAnswersPrompt(): boolean {
    return !deps.currentEditingDeliveryId() && Boolean(promptAnswerFor(deps.currentDraft(), deps.currentTarget()));
  }

  async function submitMessage(
    draftOverride?: ComposerDraft,
    targetOverride?: ConversationTarget,
    submittedSnapshot?: ComposerDraft,
    voice?: VoiceSend,
    steer = false,
  ): Promise<boolean> {
    if (deps.attachmentBusy(targetOverride)) return false;
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

  function sendWaits(target: ConversationTarget): boolean {
    const activeTarget = deps.currentTarget();
    return (
      activeTarget?.agentId === target.agentId &&
      activeTarget.serverId === target.serverId &&
      !deps.props.channel &&
      !hostSteers() &&
      (Boolean(deps.props.activeTurnId) ||
        deps.orderedQueuedDeliveries().length > 0 ||
        deps.pendingSends.list(target).some((send) => send.state !== "failed"))
    );
  }

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
    if (onScreen()) deps.followSentMessage();
    const queued = sendWaits(target);
    const send = deps.props.onSendMessage;
    const steerQueued = agentSteers() ? deps.props.onSteerQueuedMessage : deps.props.onSendQueuedMessageNow;
    const server = deps.props.server;
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
        if (steer && onScreen()) steerQueued?.(result.messageId);
      }
      return result;
    });
  }

  function retryPendingSend(clientMessageId: string): void {
    const target = deps.currentTarget();
    if (target) deps.pendingSends.retry(target, clientMessageId);
  }

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
    for (const attachment of removed?.draft.attachments ?? [])
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, target.serverId);
    if (removed) discardVoiceRecording(removed);
  }

  function discardVoiceRecording(send: PendingSend): void {
    if (send.voiceRecordingDraftId)
      void conversationRuntime(deps.props)
        .agent.discardDraftAttachment(send.voiceRecordingDraftId, LOCAL_SERVER_ID)
        .catch(() => {});
  }

  function submitComposer(): void {
    if (deps.attachmentBusy() || deps.uploadFailed()) return;
    const phase = deps.voicePhase();
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
    if (phase !== "idle" || !deps.agentReady()) return;
    void submitMessage();
  }

  function agentSteers(): boolean {
    return !deps.props.agent || agentSteersTurns(deps.props.agent, deps.props.modelOptions);
  }

  function hostSteers(): boolean {
    return agentSteers() && (deps.props.agent?.busyMessageMode ?? deps.props.defaultBusyMessageMode) === "steer";
  }

  function steerComposer(): void {
    if (deps.attachmentBusy() || deps.uploadFailed() || deps.voicePhase() !== "idle" || !deps.agentReady()) return;
    void submitMessage(undefined, undefined, undefined, undefined, !hostSteers());
  }

  async function sendSelectionInstruction(messageId: string, body: string): Promise<boolean> {
    const target = deps.currentTarget();
    if (!target || deps.submitting() || !deps.agentReady()) return false;
    const replyToMessageId = fileQuoteTarget(messageId) ? null : messageId;
    queueSend(target, { text: body, attachments: [], replyToMessageId }, body);
    return true;
  }

  function sendCardMessage(body: string, target = deps.currentTarget()): boolean {
    if (!target || deps.submitting() || !deps.agentReady()) return false;
    queueSend(target, { text: body, attachments: [], replyToMessageId: null }, body);
    return true;
  }

  function sendCardReplyNow(body: string, target = deps.currentTarget()): boolean {
    if (!target || sendWaits(target)) return false;
    return sendCardMessage(body, target);
  }

  async function sendCardFile(body: string, file: File): Promise<boolean> {
    const target = deps.currentTarget();
    if (!target || deps.submitting() || !deps.agentReady()) return false;
    const runtime = conversationRuntime(deps.props);
    const attachments = await importPastedFiles(
      [file],
      () => 0,
      (data) => runtime.agent.importAttachmentData(data, target.serverId),
    ).catch(() => []);
    if (attachments.length === 0) return false;
    queueSend(target, { text: body, attachments, replyToMessageId: null }, body);
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
    endQueuedMessageEdit,
    saveQueuedMessageEdit,
    reorderPresentedQueue,
    submitMessage,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    sendSelectionInstruction,
    sendCardMessage,
    sendCardReplyNow,
    sendCardFile,
    retryPendingSend,
    editPendingSend,
    dismissPendingSend,
  };
}
