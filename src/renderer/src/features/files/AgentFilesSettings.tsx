import { canPreviewAttachment, type StoredFileRow } from "@openbot/contracts/ipc";
import { AgentFilesView } from "@openbot/ui/features/files/AgentFilesView";
import type { FilesPort } from "./files-port";
import { smallPictureUrl } from "./library-picture-url";
import type { StorageUsageResource } from "./storage-usage";

export interface AgentFilesOptions {
  serverId: string;
  canManage: boolean;
  onOpenWorkspace?: (() => void) | undefined;
  onPreviewFile: (file: StoredFileRow) => void;
  onShowMessage: (messageId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  calls?: FilesPort | undefined;
}

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
      pictureUrl={smallPictureUrl}
      onPreviewFile={(file) =>
        canPreviewAttachment(file) ? props.onPreviewFile(file) : void props.storage.fileAction(file, "open", showInChat)
      }
      onFileAction={(file, action) => props.storage.fileAction(file, action, showInChat)}
    />
  );
}
