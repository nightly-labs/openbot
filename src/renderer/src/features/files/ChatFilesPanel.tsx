import { canPreviewAttachment, type StoredFileRow } from "@openbot/contracts/ipc";
import { ConversationFilesPanel } from "@openbot/ui/features/files/ConversationFilesPanel";
import { type FilesPort, filesPort } from "./files-port";
import { createStorageUsage } from "./storage-usage";

/** One chat, or one channel: the files sent in its messages. */
export type ChatFilesSource =
  | { scope: "conversation"; conversationId: string }
  | { scope: "channel"; channelId: string };

/** Chat > Files: every file of one chat or channel, in the side-panel slot the file preview also uses. */
export default function ChatFilesPanel(props: {
  serverId: string;
  source: ChatFilesSource;
  conversationTitle: string;
  /** Owners and admins delete files. A member only reads. */
  canManage: boolean;
  onClose: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onShowMessage: (messageId: string) => void;
  /** The storage calls of a client without the desktop port. Absent, preload sends them. */
  calls?: FilesPort | undefined;
}) {
  const storage = createStorageUsage(
    () => ({
      serverId: props.serverId,
      input: { ...props.source },
    }),
    () => props.calls ?? filesPort(),
  );
  const usage = () => storage.state.usage;
  /** A chat counts its messages too. A channel counts only its files. */
  const bytes = () => {
    const source = props.source;
    const current = usage();
    if (source.scope === "conversation")
      return current?.conversations.find((chat) => chat.id === source.conversationId)?.bytes ?? 0;
    return current?.files.reduce((total, file) => total + file.size, 0) ?? 0;
  };
  const showInChat = {
    onShowInChat: (row: StoredFileRow) => {
      if (row.messageId) props.onShowMessage(row.messageId);
    },
  };
  return (
    <ConversationFilesPanel
      conversationTitle={props.conversationTitle}
      files={usage()?.files ?? []}
      chatBytes={bytes()}
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
