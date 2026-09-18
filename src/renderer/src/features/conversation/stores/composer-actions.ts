import type { DraftAttachment, QueueDelivery } from "@openbot/contracts/ipc";
import { isQueueEditRejected, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { errorMessage } from "../../../error-message";
import { expandComposerMentions } from "../ComposerEditor";
import { copyComposerDraft, EMPTY_DRAFT, QUEUE_EDIT_STORAGE_KEY, type StoredQueueEdit } from "../composer-draft";
import { composerDraftKey } from "../conversation-keys";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "../conversation-types";

export interface ComposerActionsDeps {
  props: ConversationProps;
  agentReady: () => boolean;
  attachmentBusy: () => boolean;
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
  selectionSending: () => boolean;
  setSelectionSending: (sending: boolean) => void;
  voicePhase: () => string;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
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
  imageAttachmentPicker: () => HTMLInputElement | undefined;
  contextAttachmentPicker: () => HTMLInputElement | undefined;
}

export function createComposerActions(deps: ComposerActionsDeps) {
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
    if (!target) return;
    const pendingSave = deps.editingPendingSave();
    if (
      pendingSave &&
      deps.editingAgentId() === target.agentId &&
      deps.editingServerId() === target.serverId &&
      pendingSave.deliveryId === deps.editingDeliveryId() &&
      pendingSave.editId === deps.editingEditId()
    ) {
      for (const attachment of selected)
        void window.openbot.agent.discardDraftAttachment(attachment.id, target.serverId);
      deps.setComposerError("Save is not confirmed. Retry Save to check the result.", target);
      return;
    }
    deps.clearConversationError(target);
    const key = composerDraftKey(target);
    const draft = deps.drafts()[key] ?? EMPTY_DRAFT;
    const available = Math.max(0, 10 - draft.attachments.length);
    const accepted = selected.slice(0, available);
    for (const attachment of selected.slice(available)) {
      void window.openbot.agent.discardDraftAttachment(attachment.id, target.serverId);
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
        await window.openbot.agent.editQueuedMessage(
          {
            agentId: target.agentId,
            deliveryId,
            editId,
            action: "retain-attachments",
            attachmentDraftIds: accepted.map((item) => item.id),
          },
          target.serverId,
        );
        if (deps.editingEditId() !== editId) throw new Error("The queue edit has ended.");
      } catch (error) {
        for (const item of accepted) void window.openbot.agent.discardDraftAttachment(item.id, target.serverId);
        deps.setConversationError(target, errorMessage(error, "Could not keep these attachments with the edit."));
        return;
      }
    }
    const currentDraft = deps.drafts()[key] ?? EMPTY_DRAFT;
    const remaining = Math.max(0, 10 - currentDraft.attachments.length);
    for (const item of accepted.splice(remaining))
      void window.openbot.agent.discardDraftAttachment(item.id, target.serverId);
    deps.setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? EMPTY_DRAFT),
        attachments: [...currentDraft.attachments, ...accepted],
      },
    }));
    if (selected.length > accepted.length) deps.setComposerError("You can attach at most 10 files.", target);
    deps.setShowComposerActions(false);
  }

  function openAttachmentPicker(filter: "all" | "images") {
    deps.setShowComposerActions(false);
    deps.setComposerError(null, deps.currentTarget());
    const picker = filter === "images" ? deps.imageAttachmentPicker() : deps.contextAttachmentPicker();
    if (!picker) return;
    picker.value = "";
    picker.click();
  }

  function openAttachmentPickerFromKey(event: KeyboardEvent, filter: "all" | "images") {
    if (event.key === "Enter" || event.key === " ") openAttachmentPicker(filter);
  }

  async function editQueuedMessage(delivery: QueueDelivery) {
    const agentId = deps.props.agent?.id;
    const serverId = deps.props.server?.id ?? "local";
    if (!agentId || delivery.status !== "queued" || deps.submitting()) return;
    // A pending Save owns the outcome: keep it for retry instead of replacing it.
    if (deps.editingPendingSave()) return;
    if (deps.editingDeliveryId() && !(await cancelQueuedMessageEdit())) return;
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
        window.localStorage.setItem(
          QUEUE_EDIT_STORAGE_KEY,
          JSON.stringify({
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
          }),
        );
      // Record ownership before the request: a lost response must not free this editor slot.
      setEditingDraft(delivery);
      if (editId) {
        const held = await window.openbot.agent.editQueuedMessage(
          { agentId, action: "begin", deliveryId: delivery.id, editId },
          serverId,
        );
        const original = held.deliveries.find((item) => item.id === delivery.id);
        if (!original) throw new Error("This queued message is no longer available.");
        if (backup.attachments.length) {
          // Keep the same recovery identity if retention fails. Save retries retention;
          // Cancel uses the normal confirmed-release path.
          await window.openbot.agent.editQueuedMessage(
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
      deps.setComposerError(errorMessage(error, "Could not hold the queued message for editing."), {
        agentId,
        serverId,
      });
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
        await window.openbot.agent.editQueuedMessage(
          { agentId: target.agentId, action: "cancel", deliveryId, editId },
          serverId,
        );
      } catch (error) {
        if (!isQueueEditRejected(error)) {
          deps.setComposerError(errorMessage(error, "Could not cancel the queue edit. Try again."), target);
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
        void window.openbot.agent.discardDraftAttachment(attachment.id, serverId);
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
    window.localStorage.removeItem(QUEUE_EDIT_STORAGE_KEY);
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
      deps.setComposerError("This queued message is no longer available.", { agentId, serverId });
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
        const held = await window.openbot.agent.editQueuedMessage(
          { agentId, action: "begin", deliveryId, editId },
          serverId,
        );
        if (!held.deliveries.some((item) => item.id === deliveryId))
          throw new Error("This queued message is no longer available.");
        const backupAttachments = (deps.editingDraftBackup()?.attachments ?? []).map((attachment) => attachment.id);
        if (backupAttachments.length) {
          await window.openbot.agent.editQueuedMessage(
            { agentId, action: "retain-attachments", deliveryId, editId, attachmentDraftIds: backupAttachments },
            serverId,
          );
        }
      } catch (error) {
        deps.setSubmitting(false);
        deps.setComposerError(errorMessage(error, "Could not hold the queued message for editing."), {
          agentId,
          serverId,
        });
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
        window.localStorage.setItem(
          QUEUE_EDIT_STORAGE_KEY,
          JSON.stringify({
            agentId,
            serverId,
            deliveryId,
            editId,
            originalAttachmentIds: target?.originalAttachmentIds ?? deps.editingOriginalAttachmentIds(),
            backup: deps.editingDraftBackup() ?? EMPTY_DRAFT,
            draft,
            pendingSave,
          }),
        );
      } catch {
        deps.setEditingPendingSave(null);
        deps.setSubmitting(false);
        deps.setComposerError("Could not save this edit on this computer. Try again.", { agentId, serverId });
        return false;
      }
    }

    let saved = false;
    try {
      if (editId) {
        await window.openbot.agent.editQueuedMessage(
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
      deps.setComposerError(errorMessage(error, "Could not update the queued message. Try again."), {
        agentId,
        serverId,
      });
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
        void window.openbot.agent.discardDraftAttachment(attachment.id, serverId);
      }
      deps.setEditingAgentId(null);
      deps.setEditingServerId(null);
      deps.setEditingDeliveryId(null);
      deps.setEditingEditId(null);
      deps.setEditingPendingSave(null);
      window.localStorage.removeItem(QUEUE_EDIT_STORAGE_KEY);
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

  async function submitMessage(
    draftOverride?: ComposerDraft,
    targetOverride?: ConversationTarget,
    submittedSnapshot?: ComposerDraft,
  ): Promise<boolean> {
    if (deps.selectionSending() || deps.attachmentBusy()) return false;
    if (!draftOverride && deps.currentEditingDeliveryId()) {
      return saveQueuedMessageEdit();
    }
    const agentId = targetOverride?.agentId ?? deps.props.agent?.id;
    const target = targetOverride ?? (agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined);
    const draft = draftOverride ?? deps.currentDraft();
    const text = expandComposerMentions(draft.text);
    const attachments = draft.attachments;
    if (!agentId || !target || deps.submitting() || (!text.trim() && attachments.length === 0)) return false;
    stopTeamTyping();
    deps.setStickToLatest(true);
    deps.setSubmitting(true);
    deps.setComposerError(null, target);
    const sent = await deps.props.onSendMessage(
      text,
      attachments.map((item) => item.id),
      draft.replyToMessageId,
      target,
    );
    deps.setSubmitting(false);
    if (sent) {
      deps.clearConversationError(target);
      if (submittedSnapshot) deps.clearSubmittedDraft(target, submittedSnapshot);
      else deps.setDrafts((current) => ({ ...current, [composerDraftKey(target)]: EMPTY_DRAFT }));
    }
    return sent;
  }

  function submitComposer(): void {
    if (deps.attachmentBusy()) return;
    const phase = deps.voicePhase();
    if (phase === "recording") {
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
        deps.setComposerError("This queued message is no longer available.", target);
        cancelQueuedMessageEdit();
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
    if (phase !== "idle") return;
    void submitMessage();
  }

  async function sendSelectionInstruction(messageId: string, body: string): Promise<boolean> {
    if (!deps.props.agent || deps.submitting() || deps.selectionSending() || !deps.agentReady()) {
      return false;
    }
    deps.setSelectionSending(true);
    try {
      return await deps.props.onSendMessage(body, [], messageId);
    } finally {
      deps.setSelectionSending(false);
    }
  }

  return {
    updateTeamTyping,
    stopTeamTyping,
    addAttachments,
    openAttachmentPicker,
    openAttachmentPickerFromKey,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    saveQueuedMessageEdit,
    reorderPresentedQueue,
    submitMessage,
    submitComposer,
    sendSelectionInstruction,
  };
}

export type ComposerActions = ReturnType<typeof createComposerActions>;
