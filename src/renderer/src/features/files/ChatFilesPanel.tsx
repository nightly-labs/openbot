import { canPreviewAttachment, type StoredFileRow } from "@openbot/contracts/ipc";
import { ConversationFilesPanel } from "@openbot/ui/features/files/ConversationFilesPanel";
import { type FilesPort, filesPort } from "./files-port";
import { createSmallPictureUrl } from "./library-picture-url";
import { createStorageUsage } from "./storage-usage";

export type ChatFilesSource =
  | { scope: "conversation"; conversationId: string }
  | { scope: "channel"; channelId: string };

export default function ChatFilesPanel(props: {
  serverId: string;
  source: ChatFilesSource;
  conversationTitle: string;
  canManage: boolean;
  onClose: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onShowMessage: (messageId: string) => void;
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
  const smallPictureUrl = createSmallPictureUrl();
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
      pictureUrl={smallPictureUrl}
      onPreviewFile={(file) =>
        canPreviewAttachment(file) ? props.onPreviewFile(file) : void storage.fileAction(file, "open", showInChat)
      }
      onFileAction={(file, action) => storage.fileAction(file, action, showInChat)}
    />
  );
}
