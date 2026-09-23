import { canPreviewAttachment, type StoredFileRow } from "@openbot/contracts/ipc";
import { AgentFilesView } from "@openbot/ui/features/files/AgentFilesView";
import type { StorageUsageResource } from "./storage-usage";

export interface AgentFilesOptions {
  serverId: string;
  /** Owners and admins delete files. A member only reads. */
  canManage: boolean;
  /** Only on this computer: a remote agent's workspace is a folder on the host. */
  onOpenWorkspace?: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onShowMessage: (messageId: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

/**
 * Agent settings > Files. The settings own the storage read, because the Files row shows the same
 * total before this view opens.
 */
export function AgentFilesSettings(
  props: AgentFilesOptions & {
    agentName: string;
    storage: StorageUsageResource;
    onBack: () => void;
    onClose: () => void;
  },
) {
  const usage = () => props.storage.state.usage;
  const showInChat = {
    onShowInChat: (row: StoredFileRow) => {
      if (row.messageId) props.onShowMessage(row.messageId);
    },
  };
  return (
    <AgentFilesView
      agentName={props.agentName}
      loading={props.storage.scanState() === "scanning" && !usage()}
      error={props.storage.error()}
      onRetry={() => void props.storage.refresh(true)}
      breakdown={usage()?.breakdown ?? []}
      conversations={usage()?.conversations ?? []}
      files={usage()?.files ?? []}
      onBack={props.onBack}
      onClose={props.onClose}
      onOpenWorkspace={props.onOpenWorkspace}
      canDelete={props.canManage}
      onOpenConversation={props.onOpenConversation}
      // A file the preview panel cannot show opens in its app.
      onPreviewFile={(file) =>
        canPreviewAttachment(file) ? props.onPreviewFile(file) : void props.storage.fileAction(file, "open", showInChat)
      }
      onFileAction={(file, action) => props.storage.fileAction(file, action, showInChat)}
    />
  );
}
