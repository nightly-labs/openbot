import { useEffect, useRef } from "react";
import type { ChatAttachment } from "../../chat/components/use-chat-attachments";
import type { NativeAudiencePending } from "../model/channel-audience-send";

/** A mounted request can clear its matching composer preimage once at first confirmation. */
export function useChannelAudienceDraft(
  pending: NativeAudiencePending | null,
  draft: { text: string; files: readonly ChatAttachment[]; replyToMessageId: string | null },
  clear: () => void,
  ownerOperationId: string | null,
) {
  const current = useRef({ draft, clear });
  const handledOperationId = useRef<string | null>(null);
  current.current = { draft, clear };
  useEffect(() => {
    if (ownerOperationId !== pending?.input.operationId || !pending?.result || "status" in pending.result) return;
    if (handledOperationId.current === ownerOperationId) return;
    // Consume ownership even if the draft changed. Later status updates cannot own a new draft.
    handledOperationId.current = ownerOperationId;
    const { draft, clear } = current.current;
    if (
      draft.text.trim() !== pending.input.text ||
      draft.replyToMessageId !== pending.input.replyToMessageId ||
      draft.files.length !== pending.files.length ||
      draft.files.some((file, index) => {
        const saved = pending.files[index];
        return (
          !saved ||
          file.id !== saved.id ||
          file.name !== saved.name ||
          file.size !== saved.size ||
          file.mimeType !== saved.mimeType
        );
      })
    )
      return;
    clear();
  }, [pending, ownerOperationId]);
}
