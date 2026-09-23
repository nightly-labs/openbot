import { canPreviewAttachment, type StoredFileRow } from "@openbot/contracts/ipc";
import { ConversationFilesPanel } from "@openbot/ui/features/files/ConversationFilesPanel";
import { createStorageUsage } from "./storage-usage";

/** Chat > Files: every file of one chat, in the side-panel slot the file preview also uses. */
export default function ChatFilesPanel(props: {
  serverId: string;
  conversationId: string;
  conversationTitle: string;
  /** Owners and admins delete files. A member only reads. */
  canManage: boolean;
  onClose: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onShowMessage: (messageId: string) => void;
}) {
  const storage = createStorageUsage(() => ({
    serverId: props.serverId,
    input: { scope: "conversation", conversationId: props.conversationId },
  }));
  const usage = () => storage.state.usage;
  const showInChat = {
    onShowInChat: (row: StoredFileRow) => {
      if (row.messageId) props.onShowMessage(row.messageId);
    },
  };
  return (
    <ConversationFilesPanel
      conversationTitle={props.conversationTitle}
      files={usage()?.files ?? []}
      chatBytes={usage()?.conversations.find((chat) => chat.id === props.conversationId)?.bytes ?? 0}
      loading={storage.scanState() === "scanning" && !usage()}
      canDelete={props.canManage}
      error={storage.error()}
      onRetry={() => void storage.refresh(true)}
      onClose={props.onClose}
      // A file the preview panel cannot show opens in its app.
      onPreviewFile={(file) =>
        canPreviewAttachment(file) ? props.onPreviewFile(file) : void storage.fileAction(file, "open", showInChat)
      }
      onFileAction={(file, action) => storage.fileAction(file, action, showInChat)}
    />
  );
}
