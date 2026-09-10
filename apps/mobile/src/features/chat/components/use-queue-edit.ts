import { useRef, useState } from "react";
import type { QueueMessage } from "./chat-queue";
import type { ChatAttachments } from "./use-chat-attachments";

// Keep the normal composer draft separate while editing an existing host delivery.
export function useQueueEdit(
  draft: string,
  setDraft: (text: string) => void,
  attachments: Pick<ChatAttachments, "items" | "replace" | "clear">,
  take: (message: QueueMessage) => Promise<Pick<QueueMessage, "body" | "attachments">>,
) {
  const [queueEdit, setQueueEdit] = useState<{
    message: QueueMessage;
    text: string;
    files: ChatAttachments["items"];
  } | null>(null);
  const busy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  async function startQueueEdit(message: QueueMessage) {
    if (busy.current || queueEdit || message.delivery?.status !== "queued") return;
    busy.current = true;
    setPreparing(true);
    try {
      const prepared = await take(message);
      setQueueEdit({ message: { ...message, ...prepared }, text: draft, files: attachments.items });
      setDraft(prepared.body);
      attachments.clear();
      setFocusRequest((version) => version + 1);
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }

  function finishQueueEdit() {
    if (!queueEdit) return;
    setDraft(queueEdit.text);
    attachments.replace(queueEdit.files);
    setQueueEdit(null);
  }

  return { preparing, queueEdit, focusRequest, startQueueEdit, finishQueueEdit };
}
