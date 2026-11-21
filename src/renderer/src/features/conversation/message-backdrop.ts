import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { customBackdropChoice, messageHtmlBackdropPage } from "@openbot/ui/features/conversation/chat-backdrop";
import { useText } from "@openbot/ui/text";
import { createEffect } from "solid-js";
import { actionToast } from "../../action-toast";
import { showNewAgentBackdrop } from "../../agent-backdrops";
import { setChatBackdrop, useChatBackdrop } from "../../chat-backdrop-preference";
import { addCustomBackdrop, customBackdropKind, removeCustomBackdrop } from "../../custom-backdrops";
import type { ConversationRuntime } from "./conversation-runtime";
import { PENDING_SEND_ID_PREFIX } from "./stores/pending-send-store";

function attachmentMimeType(attachment: AttachmentSummary): string {
  return attachment.mimeType || attachmentMimeTypeForName(attachment.name);
}

interface BackdropSource {
  name: string;
  mimeType: string;
  bytes: () => Promise<Uint8Array>;
}

async function attachmentBytes(runtime: ConversationRuntime, attachment: AttachmentSummary): Promise<Uint8Array> {
  const preview = await runtime.previewAttachment?.(attachment);
  if (preview?.bytes) return preview.bytes;
  if (!attachment.previewUrl) throw new Error("The file has no address.");
  const response = await fetch(attachment.previewUrl);
  if (!response.ok) throw new Error("The file cannot be read.");
  return new Uint8Array(await response.arrayBuffer());
}

export function watchAgentBackdrops(
  runtime: ConversationRuntime,
  agentId: () => string | undefined,
  messages: () => readonly AgentMessage[],
  isOwnSender: () => (senderId: string) => boolean,
): void {
  createEffect(
    () => {
      const list = messages();
      return { agentId: agentId(), messages: list, count: list.length, isReader: isOwnSender() };
    },
    (current) => {
      if (!current.agentId) return;
      showNewAgentBackdrop<AttachmentSummary, AgentMessage>(current.agentId, current.messages, {
        title: (message) => message.body,
        bytes: (attachment) => attachmentBytes(runtime, attachment),
        isReader: current.isReader,
      });
    },
  );
}

export function useMessageBackdropAction(runtime: ConversationRuntime) {
  const { t } = useText();

  const backdropSource = (message: AgentMessage): BackdropSource | undefined => {
    if (message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX)) return;
    const visual = chatVisualReply(message)?.attachment;
    const candidates = visual ? [visual, ...(message.attachments ?? [])] : (message.attachments ?? []);
    const attachment = candidates.find(
      (candidate) => customBackdropKind(attachmentMimeType(candidate), candidate.size) !== null,
    );
    if (attachment)
      return {
        name: attachment.name,
        mimeType: attachmentMimeType(attachment),
        bytes: () => attachmentBytes(runtime, attachment),
      };
    const page = messageHtmlBackdropPage(message.body);
    if (page === null) return;
    const bytes = new TextEncoder().encode(page);
    if (customBackdropKind("text/html", bytes.byteLength) !== "page") return;
    return { name: t("chat.preview.htmlTitle"), mimeType: "text/html", bytes: async () => bytes };
  };

  const useAsBackdrop = async (source: BackdropSource) => {
    try {
      const previous = useChatBackdrop()();
      const id = await addCustomBackdrop({ name: source.name, mimeType: source.mimeType, bytes: await source.bytes() });
      const choice = customBackdropChoice(id);
      setChatBackdrop(choice);
      const undo = () => {
        if (useChatBackdrop()() !== choice) return;
        setChatBackdrop(previous);
        void removeCustomBackdrop(id).catch(() => {});
      };
      actionToast.success(t("chat.menu.backdropSet"), {
        action: { label: t("chat.backdrop.undo"), onClick: undo },
      });
    } catch {
      actionToast.error(t("chat.menu.backdropFailed"));
    }
  };

  return (message: AgentMessage): (() => void) | undefined => {
    const source = backdropSource(message);
    return source ? () => void useAsBackdrop(source) : undefined;
  };
}
