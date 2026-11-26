import { agentSteersTurns } from "@openbot/contracts/agent-providers";
import { attachmentReferenceIds } from "@openbot/contracts/attachment-references";
import type { AgentTask, QueueDelivery } from "@openbot/contracts/ipc";
import { isQueueEditRejected } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { AgentThreadQueue } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { actionToast } from "../../../action-toast";
import {
  clearStoredThreadQueueEdit,
  copyComposerDraft,
  draftAfterEndedEdit,
  EMPTY_DRAFT,
  queueEditChanged,
  type StoredThreadQueueEdit,
  storeThreadQueueEdit,
} from "../composer-draft";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps } from "../conversation-types";
import { currentConversationTarget } from "./composer-store";

const { t, errorMessage } = currentText();

type Drafts = Record<string, ComposerDraft>;
type ThreadQueueEdit = Omit<StoredThreadQueueEdit, "draft">;

export interface ThreadQueueDeps {
  props: ConversationProps;
  threadDrafts: () => Drafts;
  setThreadDrafts: (update: (current: Drafts) => Drafts) => void;
  edit: () => ThreadQueueEdit | null;
  setEdit: (edit: ThreadQueueEdit | null) => void;
  persist: boolean;
}

export function createThreadQueue(deps: ThreadQueueDeps) {
  const [busy, setBusy] = createSignal(false);
  const runtime = () => conversationRuntime(deps.props).agent;

  function draft(key: string): ComposerDraft {
    return deps.threadDrafts()[key] ?? EMPTY_DRAFT;
  }

  function setDraft(key: string, next: ComposerDraft): void {
    deps.setThreadDrafts((current) => ({ ...current, [key]: next }));
  }

  function store(edit: StoredThreadQueueEdit): void {
    if (deps.persist) storeThreadQueueEdit(edit);
  }

  function discard(ids: Iterable<string>, serverId: string): void {
    for (const id of ids) void runtime().discardDraftAttachment(id, serverId);
  }

  function editOf(taskId: string | undefined): ThreadQueueEdit | null {
    const edit = deps.edit();
    const target = currentConversationTarget(deps.props);
    return edit &&
      taskId &&
      edit.taskId === taskId &&
      target?.agentId === edit.agentId &&
      target.serverId === edit.serverId
      ? edit
      : null;
  }

  function editsDraft(key: string): boolean {
    const edit = deps.edit();
    return Boolean(edit && edit.draftKey === key && editOf(edit.taskId));
  }

  function draftLocked(key: string | undefined): boolean {
    const edit = deps.edit();
    return Boolean(key && edit?.pendingSave && edit.draftKey === key);
  }

  function keepsAttachment(id: string): boolean {
    const edit = deps.edit();
    return Boolean(
      edit && (edit.originalAttachmentIds.includes(id) || edit.backup.attachments.some((item) => item.id === id)),
    );
  }

  function finish(): void {
    deps.setEdit(null);
    if (deps.persist) clearStoredThreadQueueEdit();
  }

  async function begin(task: AgentTask, delivery: QueueDelivery, key: string): Promise<void> {
    const target = currentConversationTarget(deps.props);
    if (!target || delivery.status !== "queued" || busy()) return;
    if (deps.edit()?.pendingSave) return;
    if (deps.edit() && !(await cancel())) return;
    const backup = copyComposerDraft(draft(key));
    const edit: ThreadQueueEdit = {
      ...target,
      taskId: task.id,
      draftKey: key,
      deliveryId: delivery.id,
      editId: crypto.randomUUID(),
      originalAttachmentIds: delivery.attachments.map((attachment) => attachment.id),
      originalText: delivery.text,
      backup,
    };
    const edited: ComposerDraft = {
      text: delivery.text,
      attachments: [...delivery.attachments],
      replyToMessageId: delivery.replyToMessageId,
    };
    setBusy(true);
    try {
      store({ ...edit, draft: edited });
      deps.setEdit(edit);
      setDraft(key, edited);
      await runtime().editQueuedMessage(
        { agentId: target.agentId, action: "begin", deliveryId: delivery.id, editId: edit.editId },
        target.serverId,
      );
      if (backup.attachments.length)
        await runtime().editQueuedMessage(
          {
            agentId: target.agentId,
            action: "retain-attachments",
            deliveryId: delivery.id,
            editId: edit.editId,
            attachmentDraftIds: backup.attachments.map((attachment) => attachment.id),
          },
          target.serverId,
        );
    } catch (error) {
      actionToast.error(errorMessage(error, t("composer.error.holdQueued")));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<boolean> {
    const edit = deps.edit();
    if (!edit || busy()) return false;
    setBusy(true);
    try {
      await runtime().editQueuedMessage(
        { agentId: edit.agentId, action: "cancel", deliveryId: edit.deliveryId, editId: edit.editId },
        edit.serverId,
      );
    } catch (error) {
      if (!isQueueEditRejected(error)) {
        actionToast.error(errorMessage(error, t("composer.error.cancelEdit")));
        return false;
      }
    } finally {
      setBusy(false);
    }
    const kept = new Set([...edit.originalAttachmentIds, ...edit.backup.attachments.map((item) => item.id)]);
    discard(
      draft(edit.draftKey)
        .attachments.map((attachment) => attachment.id)
        .filter((id) => !kept.has(id)),
      edit.serverId,
    );
    setDraft(edit.draftKey, edit.backup);
    finish();
    return true;
  }

  async function save(key: string): Promise<boolean> {
    const edit = deps.edit();
    if (!edit || edit.draftKey !== key || busy()) return false;
    const current = draft(key);
    let pendingSave = edit.pendingSave;
    if (!pendingSave) {
      const text = current.text.trim();
      const referenced = attachmentReferenceIds(text);
      const sent = current.attachments.filter(
        (attachment) => attachment.kind === "image" || referenced.has(attachment.id),
      );
      const original = new Set(edit.originalAttachmentIds);
      const keepAttachmentIds = sent.filter((item) => original.has(item.id)).map((item) => item.id);
      const attachmentDraftIds = sent.filter((item) => !original.has(item.id)).map((item) => item.id);
      if (!text && sent.length === 0) return false;
      setBusy(true);
      try {
        await runtime().editQueuedMessage(
          { agentId: edit.agentId, action: "begin", deliveryId: edit.deliveryId, editId: edit.editId },
          edit.serverId,
        );
        if (edit.backup.attachments.length)
          await runtime().editQueuedMessage(
            {
              agentId: edit.agentId,
              action: "retain-attachments",
              deliveryId: edit.deliveryId,
              editId: edit.editId,
              attachmentDraftIds: edit.backup.attachments.map((attachment) => attachment.id),
            },
            edit.serverId,
          );
      } catch (error) {
        setBusy(false);
        if (isQueueEditRejected(error)) end(new Set());
        else actionToast.error(errorMessage(error, t("composer.error.holdQueued")));
        return false;
      }
      pendingSave = {
        action: "save",
        deliveryId: edit.deliveryId,
        editId: edit.editId,
        text,
        keepAttachmentIds,
        attachmentDraftIds,
      };
      try {
        store({ ...edit, draft: current, pendingSave });
      } catch {
        setBusy(false);
        actionToast.error(t("composer.error.saveEditTryAgain"));
        return false;
      }
      deps.setEdit({ ...edit, pendingSave });
    } else setBusy(true);
    try {
      await runtime().editQueuedMessage({ agentId: edit.agentId, ...pendingSave }, edit.serverId);
    } catch (error) {
      if (isQueueEditRejected(error)) {
        setBusy(false);
        end(new Set(pendingSave.attachmentDraftIds));
      } else actionToast.error(errorMessage(error, t("composer.error.updateQueued")));
      return false;
    } finally {
      setBusy(false);
    }
    const sent = new Set([...pendingSave.keepAttachmentIds, ...pendingSave.attachmentDraftIds]);
    const original = new Set(edit.originalAttachmentIds);
    discard(
      [...draft(key).attachments, ...edit.backup.attachments]
        .map((attachment) => attachment.id)
        .filter((id) => !sent.has(id) && !original.has(id)),
      edit.serverId,
    );
    setDraft(key, EMPTY_DRAFT);
    finish();
    return true;
  }

  function end(gone: ReadonlySet<string>): void {
    const edit = deps.edit();
    if (!edit) return;
    const current = draft(edit.draftKey);
    const changed = queueEditChanged(current, edit.originalText, edit.originalAttachmentIds);
    const { next, dropped } = draftAfterEndedEdit(
      { ...current, attachments: current.attachments.filter((attachment) => !gone.has(attachment.id)) },
      edit.backup,
      edit.originalAttachmentIds,
      changed,
    );
    discard(
      dropped.map((attachment) => attachment.id),
      edit.serverId,
    );
    setDraft(edit.draftKey, next);
    finish();
    if (changed) actionToast.warning(t("composer.queueEdit.endedKept"));
  }

  createEffect(
    () => {
      const edit = deps.edit();
      if (!edit || edit.pendingSave || busy()) return false;
      const threads = deps.props.threads;
      const task =
        threads?.open?.id === edit.taskId ? threads.open : (threads?.side.thread(edit.taskId)?.task ?? undefined);
      return Boolean(editOf(task?.id) && task?.queue && !task.queue.some((item) => item.id === edit.deliveryId));
    },
    (gone) => {
      if (gone) end(new Set());
    },
  );

  function view(task: AgentTask | null | undefined, key: string | undefined): AgentThreadQueue | undefined {
    const threads = deps.props.threads;
    const actions = threads?.queueActions;
    const agent = deps.props.agent;
    if (!task?.queue || !threads || !actions || !key) return undefined;
    const edit = editOf(task.id);
    const waits = task.state === "running" || task.hold !== null || threads.running >= threads.limit;
    return {
      deliveries: waits || edit ? task.queue : [],
      editingDeliveryId: edit?.deliveryId ?? null,
      editBusy: busy(),
      onSteer:
        agent && agentSteersTurns(agent, deps.props.modelOptions)
          ? (deliveryId) => actions.steer(task, deliveryId)
          : undefined,
      onCancel: (deliveryId) => actions.cancel(deliveryId),
      onEdit: (delivery) => void begin(task, delivery, key),
      onCancelEdit: () => void cancel(),
      onReorder: (deliveryIds) => actions.reorder(task.id, deliveryIds),
    };
  }

  return { view, save, cancel, editOf, editsDraft, draftLocked, keepsAttachment, busy };
}
