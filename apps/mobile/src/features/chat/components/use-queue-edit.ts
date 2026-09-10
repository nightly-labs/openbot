import { useSyncExternalStore } from "react";
import type { QueueEditStore } from "../model/queue-edit-store";
import type { QueueMessage } from "./chat-queue";
import type { ChatAttachment } from "./use-chat-attachments";

export function useQueueEdit(
  store: QueueEditStore,
  scope: { serverId: string; id: string },
  take: (message: QueueMessage) => Promise<Pick<QueueMessage, "body" | "attachments">>,
) {
  const key = JSON.stringify([scope.serverId, scope.id]);
  const state = useSyncExternalStore(store.subscribe, () => store.get(key));

  async function startQueueEdit(message: QueueMessage) {
    const current = store.get(key);
    if (current.preparing || current.queueEdit || message.delivery?.status !== "queued") return;
    store.update(key, { preparing: true });
    try {
      const prepared = await take(message);
      store.update(key, {
        queueEdit: { message: { ...message, ...prepared }, text: current.draft, files: current.items },
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
    if (!edit) return;
    store.update(key, { draft: edit.text, items: edit.files, queueEdit: null });
  }

  return {
    ...state,
    setDraft: (draft: string | ((current: string) => string)) =>
      store.update(key, { draft: typeof draft === "function" ? draft(store.get(key).draft) : draft }),
    replace: (items: ChatAttachment[]) => store.update(key, { items }),
    startQueueEdit,
    finishQueueEdit,
  };
}
