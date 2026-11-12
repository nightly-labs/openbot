import { providerSteersTurns } from "@openbot/contracts/agent-providers";
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
  EMPTY_DRAFT,
  type StoredThreadQueueEdit,
  storeThreadQueueEdit,
} from "../composer-draft";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps } from "../conversation-types";
import { currentConversationTarget } from "./composer-store";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

type Drafts = Record<string, ComposerDraft>;
type ThreadQueueEdit = Omit<StoredThreadQueueEdit, "draft">;

export interface ThreadQueueDeps {
  props: ConversationProps;
  threadDrafts: () => Drafts;
  setThreadDrafts: (update: (current: Drafts) => Drafts) => void;
  edit: () => ThreadQueueEdit | null;
  setEdit: (edit: ThreadQueueEdit | null) => void;
  /** Off in a view that keeps no drafts, such as a preview. */
  persist: boolean;
}

/**
 * The queue of a side thread, as in the agent's own chat: Steer, Delete and the order go to the host
 * at once, and Edit puts a queued message in the thread's message box. The host holds the message
 * while it is edited, so it does not start, and Send saves it in its place. The edit has its own
 * record, so a restart can still save or cancel it, and it does not take the place of an edit in the
 * agent's own chat. Only this computer sends the queue of a thread, so every edit holds the message.
 */
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

  /** The edit of this thread of the open agent, when there is one. */
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

  /** Whether Send in this thread draft saves a queued message of the open agent. */
  function editsDraft(key: string): boolean {
    const edit = deps.edit();
    return Boolean(edit && edit.draftKey === key && editOf(edit.taskId));
  }

  /** A pending Save owns the draft: the exact request stays for a retry, as in the agent's own chat. */
  function draftLocked(key: string | undefined): boolean {
    const edit = deps.edit();
    return Boolean(key && edit?.pendingSave && edit.draftKey === key);
  }

  /** A file of the queued message or of the draft before the edit. A removal from the draft must not delete it. */
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
    // A pending Save owns the outcome: keep it for a retry instead of replacing it.
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
      backup,
    };
    const edited: ComposerDraft = {
      text: delivery.text,
      attachments: [...delivery.attachments],
      replyToMessageId: delivery.replyToMessageId,
    };
    setBusy(true);
    try {
      // Record the edit before the request: a lost answer must not free the hold that the host keeps.
      store({ ...edit, draft: edited });
      deps.setEdit(edit);
      setDraft(key, edited);
      // The answer is the queue of the agent's own chat, which has no message of a thread. The host
      // refuses a message that no longer waits.
      await runtime().editQueuedMessage(
        { agentId: target.agentId, action: "begin", deliveryId: delivery.id, editId: edit.editId },
        target.serverId,
      );
      // The files of the draft before the edit stay until the edit ends.
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

  /** Ends the edit and gives the thread its draft from before the edit. False when the host refused. */
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
      // A message that started, or left the queue, has no hold to give back.
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

  /**
   * Saves the draft as the queued message, with the files that its text names and its images, as a
   * send of the thread takes them. A lost answer leaves the exact request, and a retry sends it again.
   */
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
      // A Begin that never reached the host leaves no hold. Confirm the hold with the same edit first.
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
        actionToast.error(errorMessage(error, t("composer.error.holdQueued")));
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
      // Store the exact request before it goes: a lost answer must stay retryable.
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
      actionToast.error(errorMessage(error, t("composer.error.updateQueued")));
      return false;
    } finally {
      setBusy(false);
    }
    // The saved message took the files that it names. The draft from before the edit is not restored,
    // as in the agent's own chat, so its files go too.
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

  // A queued message that left its thread while it was edited, such as a delete on another device,
  // ends the edit. Only a thread that shows its queue can tell.
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
      if (gone) void cancel();
    },
  );

  /** The queue of a thread for its view. Undefined where the host sends no queue of a thread. */
  function view(task: AgentTask | null | undefined, key: string | undefined): AgentThreadQueue | undefined {
    const threads = deps.props.threads;
    const actions = threads?.queueActions;
    const agent = deps.props.agent;
    if (!task?.queue || !threads || !actions || !key) return undefined;
    const edit = editOf(task.id);
    // A message to a thread that waits for nothing starts at once, as the first message of a new
    // thread does. As in the agent's own chat, it does not show in the queue for that moment.
    const waits = task.state === "running" || task.hold !== null || threads.running >= threads.limit;
    return {
      deliveries: waits || edit ? task.queue : [],
      editingDeliveryId: edit?.deliveryId ?? null,
      editBusy: busy(),
      onSteer:
        agent && providerSteersTurns(agent.provider) ? (deliveryId) => actions.steer(task, deliveryId) : undefined,
      onCancel: (deliveryId) => actions.cancel(deliveryId),
      onEdit: (delivery) => void begin(task, delivery, key),
      onCancelEdit: () => void cancel(),
      onReorder: (deliveryIds) => actions.reorder(task.id, deliveryIds),
    };
  }

  return { view, save, cancel, editOf, editsDraft, draftLocked, keepsAttachment, busy };
}
