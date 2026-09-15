import type { QueueDelivery } from "@openbot/contracts/ipc";
import { userErrorMessage } from "@openbot/user-errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { decodeQueueEditDraft, orderedQueue, type QueueEditDraft } from "../model/queue-edit-draft";
import { uploadChatAttachments } from "../model/upload-chat-attachments";
import type { ChatAttachment } from "./use-chat-attachments";

const EMPTY_DELIVERIES: QueueDelivery[] = [];

export function useChatQueue(agentId: string, serverId: string, online: boolean, activeTurnId: string | null) {
  const { loadQueue, changeQueue, editQueue, canEditQueue, uploadAttachment, discardAttachment } = useMobileWorkspace();
  const { session } = useMobileSession();
  const storageKey = `queue-edit.${session?.user.id}.${serverId}.${agentId}`;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["chat-queue", serverId, agentId], [serverId, agentId]);
  const query = useQuery({ queryKey, queryFn: () => loadQueue(agentId, serverId), enabled: online, retry: false });
  const [error, setError] = useState<string | null>(null);
  const [restored] = useState(() => {
    try {
      return { edit: decodeQueueEditDraft(SecureStore.getItem(storageKey)), error: null };
    } catch (cause) {
      return { edit: null, error: userErrorMessage(cause, "Could not read the saved queue edit.") };
    }
  });
  const [edit, setEdit] = useState<QueueEditDraft | null>(restored.edit);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);
  const editUnavailable = Boolean(
    edit &&
      query.data &&
      query.data.deliveries.some((item) => item.id === edit.delivery.id && item.status !== "queued"),
  );
  const queued = useMemo(() => orderedQueue(query.data?.deliveries ?? []), [query.data]);
  // Persist typing after a pause, without blocking each key event. The edit identity is
  // persisted synchronously BEFORE requesting the host hold, so a restart can recover it.
  useEffect(() => {
    if (!edit) return;
    const timer = setTimeout(() => {
      try {
        if (editRef.current !== edit) return;
        SecureStore.setItem(storageKey, JSON.stringify(edit));
      } catch (cause) {
        setError(userErrorMessage(cause, "Could not save the edit on this phone."));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [edit, storageKey]);
  useEffect(
    () => () => {
      if (editRef.current) {
        // The host still holds the original if the final local write fails.
        try {
          SecureStore.setItem(storageKey, JSON.stringify(editRef.current));
        } catch {
          /* Previous durable draft remains available. */
        }
      }
    },
    [storageKey],
  );
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);
  useEffect(() => {
    if (online) refresh();
  }, [online, refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current || !online) return false;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (cause) {
        setError(userErrorMessage(cause, "Could not change the queue. Refresh and try again."));
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
    if (editRef.current)
      queryClient.removeQueries({ queryKey: ["queue-edit-attachments", serverId, agentId, editRef.current.editId] });
    editRef.current = null;
    setEdit(null);
    setConfirmed(false);
  }, [storageKey, queryClient, serverId, agentId]);
  const begin = useCallback(
    async (delivery: QueueDelivery) => {
      if (edit && edit.delivery.id !== delivery.id) return;
      const next = edit ?? {
        editId: Crypto.randomUUID(),
        initialized: false,
        delivery,
        text: delivery.text,
        keepAttachmentIds: delivery.attachments.map((item) => item.id),
      };
      await run(async () => {
        SecureStore.setItem(storageKey, JSON.stringify(next));
        editRef.current = next;
        setEdit(next);
        const currentQueue = await editQueue(agentId, serverId, {
          action: "begin",
          deliveryId: delivery.id,
          editId: next.editId,
        });
        if (!next.initialized) {
          const currentDelivery = currentQueue.deliveries.find(
            (item) => item.id === delivery.id && item.status === "queued",
          );
          if (!currentDelivery) throw new Error("This queued message is no longer available.");
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
    [edit, run, storageKey, editQueue, agentId, serverId],
  );
  const save = useCallback(
    async (text: string, files: ChatAttachment[]) => {
      if (!edit || !confirmed) return false;
      if (!text.trim() && !edit.keepAttachmentIds.length && !files.length) return false;
      cancelled.current = false;
      const saved = await run(async () => {
        await uploadChatAttachments(files, {
          upload: (file) => uploadAttachment(agentId, file, serverId),
          discard: (id) => discardAttachment(agentId, id, serverId),
          cancelled: () => cancelled.current,
          progress: files.length ? setProgress : undefined,
          send: async (ids) => {
            await editQueue(agentId, serverId, {
              action: "save",
              deliveryId: edit.delivery.id,
              editId: edit.editId,
              text,
              keepAttachmentIds: edit.keepAttachmentIds,
              attachmentDraftIds: ids,
            });
            return edit.delivery.id;
          },
        });
        await clearEdit();
      });
      setProgress(null);
      return saved;
    },
    [edit, confirmed, run, uploadAttachment, discardAttachment, editQueue, agentId, serverId, clearEdit],
  );
  return useMemo(
    () => ({
      serverId,
      editUnavailable,
      discardFinishedEdit: () =>
        run(async () => {
          if (editUnavailable) await clearEdit();
        }),
      queued,
      deliveries: query.data?.deliveries ?? EMPTY_DELIVERIES,
      edit,
      confirmed,
      busy,
      progress,
      error:
        error ?? restored.error ?? (query.error ? userErrorMessage(query.error, "Could not load the queue.") : null),
      loading: online && query.isPending,
      canEdit: canEditQueue(serverId),
      online,
      activeTurnId,
      begin,
      save,
      refresh,
      changeText: (text: string) => setEdit((current) => (current ? { ...current, text } : current)),
      removeAttachment: (id: string) =>
        setEdit((current) =>
          current
            ? { ...current, keepAttachmentIds: current.keepAttachmentIds.filter((item) => item !== id) }
            : current,
        ),
      cancelUpload: () => {
        cancelled.current = true;
      },
      cancelEdit: () =>
        run(async () => {
          if (!edit) return;
          await editQueue(agentId, serverId, { action: "cancel", deliveryId: edit.delivery.id, editId: edit.editId });
          await clearEdit();
        }),
      remove: (delivery: QueueDelivery) =>
        run(async () => {
          await changeQueue(agentId, serverId, "cancel", { deliveryId: delivery.id });
          if (edit?.delivery.id === delivery.id) await clearEdit();
        }),
      steer: (delivery: QueueDelivery) =>
        run(async () => {
          if (!activeTurnId) return;
          await changeQueue(agentId, serverId, "steer", { deliveryId: delivery.id, expectedTurnId: activeTurnId });
        }),
      moveFirst: (delivery: QueueDelivery) =>
        run(async () => {
          await changeQueue(agentId, serverId, "reorder", {
            deliveryIds: [delivery.id, ...queued.filter((item) => item.id !== delivery.id).map((item) => item.id)],
          });
        }),
    }),
    [
      queued,
      editUnavailable,
      query.data,
      edit,
      confirmed,
      busy,
      progress,
      error,
      restored.error,
      query.error,
      query.isPending,
      canEditQueue,
      online,
      activeTurnId,
      begin,
      save,
      refresh,
      run,
      editQueue,
      changeQueue,
      agentId,
      serverId,
      clearEdit,
    ],
  );
}
export type ChatQueueController = ReturnType<typeof useChatQueue>;
