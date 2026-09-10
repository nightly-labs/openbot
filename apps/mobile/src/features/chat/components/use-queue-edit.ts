import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PreparedQueueEdit } from "../model/queue-edit-operations";
import type { QueueEditStore } from "../model/queue-edit-store";
import type { QueueMessage } from "./chat-queue";
import type { ChatAttachment } from "./use-chat-attachments";

export function useQueueEdit(
  store: QueueEditStore,
  scope: { serverId: string; id: string },
  take: (message: QueueMessage) => Promise<PreparedQueueEdit>,
  recover?: () => Promise<(PreparedQueueEdit & { message: QueueMessage }) | null>,
  online = true,
) {
  const key = JSON.stringify([scope.serverId, scope.id]);
  const state = useSyncExternalStore(store.subscribe, () => store.get(key));

  const recoveredKey = useRef<string | null>(null);
  useEffect(() => {
    if (!online) {
      recoveredKey.current = null;
      return;
    }
    if (!recover || recoveredKey.current === key || store.get(key).queueEdit || store.get(key).preparing) return;
    recoveredKey.current = key;
    store.update(key, { preparing: true });
    void recover()
      .then((prepared) => {
        const current = store.get(key);
        if (prepared && !current.queueEdit)
          store.update(key, {
            queueEdit: {
              message: prepared.message,
              session: prepared.session,
              text: current.draft,
              files: current.items,
            },
            draft: prepared.body,
            items: [],
            focusRequest: current.focusRequest + 1,
          });
      })
      .catch(() => {
        store.update(key, { error: "Could not recover the queue edit. Reopen this chat to try again." });
      })
      .finally(() => store.update(key, { preparing: false }));
  }, [store, key, recover, online]);

  async function startQueueEdit(message: QueueMessage) {
    const current = store.get(key);
    if (current.preparing || current.queueEdit || message.delivery?.status !== "queued") return;
    store.update(key, { preparing: true });
    try {
      const prepared = await take(message);
      store.update(key, {
        queueEdit: {
          message: { ...message, body: prepared.body, attachments: prepared.attachments },
          session: prepared.session,
          text: current.draft,
          files: current.items,
        },
        draft: prepared.body,
        items: [],
        focusRequest: current.focusRequest + 1,
      });
    } finally {
      store.update(key, { preparing: false });
    }
  }

  function finishQueueEdit() {
    const edit = store.get(key).queueEdit;
    if (!edit || store.get(key).sending) return;
    store.update(key, { draft: edit.text, items: edit.files, queueEdit: null });
  }

  async function sendQueueEdit(send: () => Promise<void>): Promise<boolean> {
    const current = store.get(key);
    if (!current.queueEdit || current.sending || current.preparing) return false;
    store.update(key, { sending: true });
    try {
      await send();
      store.update(key, { draft: current.queueEdit.text, items: current.queueEdit.files, queueEdit: null });
      return true;
    } finally {
      store.update(key, { sending: false });
    }
  }

  return {
    ...state,
    setDraft: (draft: string | ((current: string) => string)) => {
      if (store.get(key).sending) return;
      const text = typeof draft === "function" ? draft(store.get(key).draft) : draft;
      store.update(key, { draft: text });
      const edit = store.get(key).queueEdit;
      if (edit)
        void edit.session
          .save({ text, attachmentDraftIds: edit.message.attachments?.map((file) => file.id) ?? [] })
          .then(() => store.update(key, { error: null }))
          .catch(() => store.update(key, { error: "Could not save the edit on the host. Try again." }));
    },
    replace: (items: ChatAttachment[]) => {
      if (!store.get(key).sending) store.update(key, { items });
    },
    sendQueueEdit,
    startQueueEdit,
    finishQueueEdit,
  };
}
