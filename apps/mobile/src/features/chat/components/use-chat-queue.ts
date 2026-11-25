import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentTask,
  type ConversationMessage,
  isQueuedAgentReply,
  type QueueDelivery,
  routineRunsTurn,
} from "@openbot/contracts/ipc";
import { isQueueEditRejected } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { type MobileTextKey, sourceText } from "@openbot/i18n/mobile";
import { replaceEqualDeep, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentWaits } from "@/features/workspace/components/use-agent-activity";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { addStartedTask } from "@/features/workspace/model/task-cache";
import { withUploadCancel } from "@/features/workspace/model/upload-cancels";
import { currentText, useText } from "@/shared/lib/text";
import { useHiddenReplies } from "../context/queued-messages-context";
import { type AwaitingReply, awaitingReplies } from "../model/awaiting-replies";
import {
  queueAttachmentUpload,
  removeQueueAttachment,
  restoredQueueAttachments,
  writeQueueAttachment,
} from "../model/queue-edit-attachment-files";
import {
  decodeQueueEditDraft,
  orderedQueue,
  type QueueEditDraft,
  QueueEditDraftError,
  type StoredQueueAttachment,
} from "../model/queue-edit-draft";
import { ChatUploadCancelledError, uploadChatAttachments } from "../model/upload-chat-attachments";
import type { ChatAttachment } from "./use-chat-attachments";

const EMPTY_DELIVERIES: QueueDelivery[] = [];
const EMPTY_MESSAGES: readonly ConversationMessage[] = [];

const DRAFT_ERROR_KEYS = {
  edit: "mobile.chat.queue.readEditFailed",
  attachments: "mobile.chat.queue.readAttachmentsFailed",
  pendingSave: "mobile.chat.queue.readPendingSaveFailed",
} as const satisfies Record<QueueEditDraftError["part"], MobileTextKey>;

function firstIds(waiting: readonly QueueDelivery[], delivery: QueueDelivery): string[] {
  return [delivery.id, ...waiting.filter((item) => item.id !== delivery.id).map((item) => item.id)];
}

export function useChatQueue(
  agentId: string,
  serverId: string,
  online: boolean,
  activeTurnId: string | null,
  steers: boolean,
  messages: readonly ConversationMessage[] = EMPTY_MESSAGES,
) {
  const workspace = useMobileWorkspaceReader();
  const canEditQueue = useMobileWorkspaceSelector((current) => current.canEditQueue(serverId));
  const canRunAsThread = useMobileWorkspaceSelector((current) => current.canRunQueuedMessageAsTask(serverId));
  const text = useText();
  const { session } = useMobileSession();
  const storageKey = `queue-edit.${session?.user.id}.${serverId}.${agentId}`;
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const queryKey = useMemo(() => queryKeys.chatQueue(serverId, agentId), [serverId, agentId]);
  const query = useQuery({
    queryKey,
    queryFn: () => workspace().loadQueue(agentId, serverId),
    enabled: online,
    refetchOnMount: "always",
    retry: false,
  });
  const canReadUsageLimits = useMobileWorkspaceSelector((current) => current.canReadAgentUsageLimits(serverId));
  const usageLimits = useQuery({
    queryKey: queryKeys.agentUsageLimits(queryScope, serverId),
    queryFn: () => workspace().loadAgentUsageLimits(serverId),
    enabled: online && canReadUsageLimits && (query.data?.deliveries.length ?? 0) > 0,
    retry: false,
  });
  const usageLimit = usageLimits.data?.usageLimits.find((limit) => limit.agentId === agentId) ?? null;
  const [error, setError] = useState<string | null>(null);
  const activeTurnRef = useRef(activeTurnId);
  activeTurnRef.current = activeTurnId;
  const [restored] = useState(() => {
    try {
      return { edit: decodeQueueEditDraft(SecureStore.getItem(storageKey)), error: null };
    } catch (cause) {
      const { t, errorMessage } = currentText();
      return {
        edit: null,
        error:
          cause instanceof QueueEditDraftError
            ? t(DRAFT_ERROR_KEYS[cause.part])
            : errorMessage(cause, t("mobile.chat.queue.readEditFailed")),
      };
    }
  });
  const [edit, setEdit] = useState<QueueEditDraft | null>(restored.edit);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [confirmed, setConfirmed] = useState(Boolean(restored.edit?.pendingSave));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);
  const editUnavailable = Boolean(
    edit &&
      !edit.pendingSave &&
      !busy &&
      query.data?.deliveries.some((item) => item.id === edit.delivery.id && item.status !== "queued"),
  );
  const queued = useMemo(
    () => orderedQueue((query.data?.deliveries ?? []).filter((item) => !isQueuedAgentReply(item))),
    [query.data],
  );
  const replies = useMemo(() => orderedQueue((query.data?.deliveries ?? []).filter(isQueuedAgentReply)), [query.data]);
  const { hiddenReplyIds, hideReplies } = useHiddenReplies();
  const waits = useAgentWaits(serverId, online);
  const lastWaiting = useRef<AwaitingReply[]>([]);
  const waiting = useMemo(() => {
    const rows = awaitingReplies(messages, replies, waits).filter(
      (row) => !(hiddenReplyIds.has(row.id) && (row.state === "replied" || row.state === "failed")),
    );
    lastWaiting.current = replaceEqualDeep(lastWaiting.current, rows);
    return lastWaiting.current;
  }, [messages, replies, waits, hiddenReplyIds]);
  useEffect(() => {
    if (!edit) return;
    const timer = setTimeout(() => {
      try {
        if (editRef.current !== edit) return;
        SecureStore.setItem(storageKey, JSON.stringify(edit));
      } catch (cause) {
        const { t, errorMessage } = currentText();
        setError(errorMessage(cause, t("mobile.chat.queue.saveEditFailed")));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [edit, storageKey]);
  useEffect(
    () => () => {
      if (editRef.current) {
        try {
          SecureStore.setItem(storageKey, JSON.stringify(editRef.current));
        } catch {}
      }
    },
    [storageKey],
  );
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    wasOnline.current = online;
  }, [online, queryClient, queryKey]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return false;
      if (!online) {
        setError(currentText().t("mobile.chat.queue.reconnect"));
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (cause) {
        const { t, errorMessage } = currentText();
        setError(
          cause instanceof ChatUploadCancelledError
            ? t("mobile.chat.upload.cancelled")
            : errorMessage(cause, t("mobile.chat.queue.changeFailed")),
        );
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
        refresh();
      }
    },
    [online, refresh],
  );
  const clearEdit = useCallback(async () => {
    await SecureStore.deleteItemAsync(storageKey);
    const previous = editRef.current;
    editRef.current = null;
    setEdit(null);
    setConfirmed(false);
    if (previous)
      await Promise.allSettled([
        ...previous.addedAttachments.map((file) => removeQueueAttachment(previous.editId, file)),
        ...(previous.pendingSave?.attachmentDraftIds ?? []).map((id) =>
          workspace().discardAttachment(agentId, id, serverId),
        ),
      ]);
  }, [storageKey, workspace, agentId, serverId]);
  const begin = useCallback(
    async (delivery: QueueDelivery) => {
      if (edit && edit.delivery.id !== delivery.id) return;
      if (edit?.pendingSave) {
        setConfirmed(true);
        return;
      }
      const next = edit ?? {
        editId: Crypto.randomUUID(),
        initialized: false,
        delivery,
        text: delivery.text,
        keepAttachmentIds: delivery.attachments.map((item) => item.id),
        addedAttachments: [],
      };
      await run(async () => {
        SecureStore.setItem(storageKey, JSON.stringify(next));
        editRef.current = next;
        setEdit(next);
        const currentQueue = await workspace()
          .editQueue(agentId, serverId, {
            action: "begin",
            deliveryId: delivery.id,
            editId: next.editId,
          })
          .catch(async (cause) => {
            if (isQueueEditRejected(cause)) await clearEdit();
            throw cause;
          });
        if (!next.initialized) {
          const currentDelivery = currentQueue.deliveries.find(
            (item) => item.id === delivery.id && item.status === "queued",
          );
          if (!currentDelivery) throw new Error(sourceText("error.backend.queuedMessageUnavailable"));
          const ready = {
            ...next,
            initialized: true,
            delivery: currentDelivery,
            text: currentDelivery.text,
            keepAttachmentIds: currentDelivery.attachments.map((file) => file.id),
          };
          SecureStore.setItem(storageKey, JSON.stringify(ready));
          editRef.current = ready;
          setEdit(ready);
        }
        setConfirmed(true);
      });
    },
    [edit, run, storageKey, workspace, agentId, serverId, clearEdit],
  );
  const changeAttachments = useCallback(
    async (files: ChatAttachment[]) => {
      const current = editRef.current;
      if (!current || busyRef.current || current.pendingSave)
        throw new Error(currentText().t("mobile.chat.queue.editBusy"));
      busyRef.current = true;
      setBusy(true);
      const created: StoredQueueAttachment[] = [];
      try {
        const addedAttachments: StoredQueueAttachment[] = [];
        for (const file of files) {
          const existing = current.addedAttachments.find((item) => item.id === file.id);
          if (existing) addedAttachments.push(existing);
          else {
            const stored = await writeQueueAttachment(current.editId, file);
            created.push(stored);
            addedAttachments.push(stored);
          }
        }
        if (editRef.current?.editId !== current.editId) throw new Error(currentText().t("mobile.chat.queue.editEnded"));
        const next = { ...editRef.current, addedAttachments };
        SecureStore.setItem(storageKey, JSON.stringify(next));
        editRef.current = next;
        setEdit(next);
        await Promise.allSettled(
          current.addedAttachments
            .filter((file) => !addedAttachments.some((item) => item.id === file.id))
            .map((file) => removeQueueAttachment(current.editId, file)),
        );
      } catch (cause) {
        await Promise.allSettled(created.map((file) => removeQueueAttachment(current.editId, file)));
        throw cause;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [storageKey],
  );
  const attachments = useMemo(() => (edit ? restoredQueueAttachments(edit.editId, edit.addedAttachments) : []), [edit]);
  const save = useCallback(
    async (text: string, files: ChatAttachment[]) => {
      if (!edit || !confirmed) return false;
      if (!edit.pendingSave && !text.trim() && !edit.keepAttachmentIds.length && !files.length) return false;
      cancelled.current = false;
      const saved = await run(async () => {
        if (edit.pendingSave) {
          await workspace().editQueue(agentId, serverId, edit.pendingSave);
          await clearEdit();
          return;
        }
        if (edit.keepAttachmentIds.length + files.length > INPUT_LIMITS.attachments)
          throw new Error(currentText().t("mobile.chat.attachment.limit", { limit: INPUT_LIMITS.attachments }));
        await uploadChatAttachments(files, {
          upload: async (file) => {
            const stored = edit.addedAttachments.find((item) => item.id === file.id);
            const upload = stored ? await queueAttachmentUpload(edit.editId, stored, file) : file;
            return withUploadCancel(
              upload,
              () => cancelled.current,
              () => workspace().uploadAttachment(agentId, upload, serverId),
            );
          },
          discard: async (id) => {
            if (!editRef.current?.pendingSave) await workspace().discardAttachment(agentId, id, serverId);
          },
          cancelled: () => cancelled.current,
          progress: files.length ? setProgress : undefined,
          send: async (ids) => {
            if (ids.length)
              await workspace().editQueue(agentId, serverId, {
                action: "retain-attachments",
                deliveryId: edit.delivery.id,
                editId: edit.editId,
                attachmentDraftIds: ids,
              });
            const pendingSave = {
              action: "save" as const,
              deliveryId: edit.delivery.id,
              editId: edit.editId,
              text,
              keepAttachmentIds: edit.keepAttachmentIds,
              attachmentDraftIds: ids,
            };
            const next = { ...edit, text, pendingSave };
            SecureStore.setItem(storageKey, JSON.stringify(next));
            editRef.current = next;
            setEdit(next);
            await workspace().editQueue(agentId, serverId, pendingSave);
            return edit.delivery.id;
          },
        });
        await clearEdit();
      });
      setProgress(null);
      return saved;
    },
    [edit, confirmed, run, workspace, agentId, serverId, clearEdit, storageKey],
  );
  return useMemo(
    () => ({
      chatId: `${serverId}:${agentId}`,
      agentId,
      serverId,
      attachments,
      changeAttachments,
      attachmentSupport: () => workspace().attachmentSupport(serverId),
      editUnavailable,
      discardFinishedEdit: () =>
        run(async () => {
          if (editUnavailable) await clearEdit();
        }),
      queued,
      replies,
      waiting,
      hideWaiting: () => hideReplies(waiting.map((row) => row.id)),
      deliveries: query.data?.deliveries ?? EMPTY_DELIVERIES,
      restartingProvider: query.data?.hold?.reason === "provider-restart" ? query.data.hold.provider : null,
      signInProvider: query.data?.hold?.reason === "sign-in" ? query.data.hold.provider : null,
      usageLimit,
      edit,
      confirmed,
      busy,
      progress,
      error:
        error ??
        restored.error ??
        (query.error ? text.errorMessage(query.error, text.t("mobile.chat.queue.loadFailed")) : null),
      loading: online && query.isPending,
      canEdit: canEditQueue,
      canRunAsThread,
      online,
      activeTurnId,
      steers,
      steerRefused: steers && routineRunsTurn(query.data?.deliveries, activeTurnId),
      begin,
      save,
      refresh,
      changeText: (text: string) =>
        setEdit((current) => (current && !current.pendingSave && !busyRef.current ? { ...current, text } : current)),
      removeAttachment: (id: string) =>
        setEdit((current) =>
          current && !current.pendingSave && !busyRef.current
            ? { ...current, keepAttachmentIds: current.keepAttachmentIds.filter((item) => item !== id) }
            : current,
        ),
      cancelUpload: () => {
        cancelled.current = true;
      },
      cancelEdit: async () => {
        if (!edit) return true;
        let rejected = false;
        const released = await run(async () => {
          try {
            await workspace().editQueue(agentId, serverId, {
              action: "cancel",
              deliveryId: edit.delivery.id,
              editId: edit.editId,
            });
          } catch (cause) {
            rejected = isQueueEditRejected(cause);
            throw cause;
          }
          await clearEdit();
        });
        if (!released && rejected) await clearEdit();
        return released || rejected;
      },
      remove: (delivery: QueueDelivery) =>
        run(async () => {
          await workspace().changeQueue(agentId, serverId, "cancel", { deliveryId: delivery.id });
          if (edit?.delivery.id === delivery.id) await clearEdit();
        }),
      steer: (delivery: QueueDelivery) =>
        run(async () => {
          if (!activeTurnId || routineRunsTurn(query.data?.deliveries, activeTurnId)) return;
          await workspace().changeQueue(agentId, serverId, "steer", {
            deliveryId: delivery.id,
            expectedTurnId: activeTurnId,
          });
        }),
      sendNow: (delivery: QueueDelivery) =>
        run(async () => {
          const turnId = activeTurnId;
          if (!turnId) return;
          const waiting = orderedQueue(query.data?.deliveries ?? []);
          if (waiting[0]?.editing && waiting[0].id !== delivery.id) return;
          if (waiting[0]?.id !== delivery.id)
            await workspace().changeQueue(agentId, serverId, "reorder", { deliveryIds: firstIds(waiting, delivery) });
          if (activeTurnRef.current !== turnId) return;
          await workspace().interruptTurn(agentId, turnId, serverId);
        }),
      runAsThread: async (delivery: QueueDelivery): Promise<AgentTask | null> => {
        const started: { task: AgentTask | null } = { task: null };
        const done = await run(async () => {
          started.task = await workspace().runQueuedMessageAsTask({ agentId, deliveryId: delivery.id }, serverId);
        });
        const task = done ? started.task : null;
        if (task) addStartedTask(queryClient, queryScope, serverId, task);
        return task;
      },
      moveFirst: (delivery: QueueDelivery) =>
        run(async () => {
          await workspace().changeQueue(agentId, serverId, "reorder", {
            deliveryIds: firstIds(orderedQueue(query.data?.deliveries ?? []), delivery),
          });
        }),
    }),
    [
      attachments,
      changeAttachments,
      queued,
      replies,
      waiting,
      hideReplies,
      editUnavailable,
      query.data,
      usageLimit,
      edit,
      confirmed,
      busy,
      progress,
      error,
      restored.error,
      query.error,
      query.isPending,
      canEditQueue,
      canRunAsThread,
      online,
      activeTurnId,
      steers,
      begin,
      save,
      refresh,
      run,
      workspace,
      agentId,
      serverId,
      clearEdit,
      text,
      queryClient,
      queryScope,
    ],
  );
}
export type ChatQueueController = ReturnType<typeof useChatQueue>;
