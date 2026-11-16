import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { customBackdropChoice, messageHtmlBackdropPage } from "@openbot/ui/features/conversation/chat-backdrop";
import { useText } from "@openbot/ui/text";
import { createEffect } from "solid-js";
import { actionToast } from "../../action-toast";
import { showNewAgentBackdrop } from "../../agent-backdrops";
import { setChatBackdrop } from "../../chat-backdrop-preference";
import { addCustomBackdrop, customBackdropKind } from "../../custom-backdrops";
import type { ConversationRuntime } from "./conversation-runtime";
import { PENDING_SEND_ID_PREFIX } from "./stores/pending-send-store";

/** The type of a message file. A host can send a file with no type, so its name gives it. */
function attachmentMimeType(attachment: AttachmentSummary): string {
  return attachment.mimeType || attachmentMimeTypeForName(attachment.name);
}

interface BackdropSource {
  name: string;
  mimeType: string;
  bytes: () => Promise<Uint8Array>;
}

/** The browser client reads a host file through the connection; the desktop reads its file URL. */
async function attachmentBytes(runtime: ConversationRuntime, attachment: AttachmentSummary): Promise<Uint8Array> {
  const preview = await runtime.previewAttachment?.(attachment);
  if (preview?.bytes) return preview.bytes;
  if (!attachment.previewUrl) throw new Error("The file has no address.");
  const response = await fetch(attachment.previewUrl);
  if (!response.ok) throw new Error("The file cannot be read.");
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Puts a new page that the agent of the open chat set with `set_backdrop` behind the window. The web
 * client reads only the open chat; the desktop also shows the pages of the other chats
 * (`agent-event-bridge.tsx`). `isOwnSender` tells whether a sender id is the reader, so a page that
 * another member of a joined server asked for stays off this window.
 */
export function watchAgentBackdrops(
  runtime: ConversationRuntime,
  agentId: () => string | undefined,
  messages: () => readonly AgentMessage[],
  isOwnSender: () => (senderId: string) => boolean,
): void {
  createEffect(
    // A store array can grow in place, so its length is read too.
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

/**
 * The "Use as backdrop" item of a message menu, in the chat and in a thread. It returns the action of
 * a message, or undefined when the message has nothing that can go behind the window.
 */
export function useMessageBackdropAction(runtime: ConversationRuntime) {
  const { t } = useText();

  /**
   * What a finished message can put behind the window: the agent's visual page first, then the first
   * picture, GIF or HTML page that the message carries, then the first HTML block of its text.
   */
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
      const id = await addCustomBackdrop({ name: source.name, mimeType: source.mimeType, bytes: await source.bytes() });
      setChatBackdrop(customBackdropChoice(id));
      actionToast.success(t("chat.menu.backdropSet"));
    } catch {
      actionToast.error(t("chat.menu.backdropFailed"));
    }
  };

  return (message: AgentMessage): (() => void) | undefined => {
    const source = backdropSource(message);
    return source ? () => void useAsBackdrop(source) : undefined;
  };
}
