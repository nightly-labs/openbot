import { Button, Folder, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { Show } from "solid-js";
import { formatFileSize } from "../conversation/AttachmentCards";
import { FileList } from "./FileList";
import { fileCountLabel, type StoredFileAction, type StoredFileRow } from "./files-view";

export interface ConversationFilesPanelProps {
  conversationTitle: string;
  files: readonly StoredFileRow[];
  /** Messages and files of this chat together. */
  chatBytes: number;
  /** Names the sender agent in a group chat. Leave it out in a chat with one agent. */
  agents?: readonly AgentProfile[];
  loading?: boolean;
  /** The viewer can delete files of this chat. */
  canDelete?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Panel width in pixels. The resizer of the real panel sets it later. */
  width?: number;
  now?: Date;
  onClose: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onFileAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}

/**
 * Chat > Files: every file of one chat, newest first by day, in the same side-panel frame as the
 * file preview. "Show in chat" in a row menu scrolls the conversation to the message.
 */
export function ConversationFilesPanel(props: ConversationFilesPanelProps) {
  return (
    <aside
      class="browser-panel conversation-files-panel"
      aria-label={`Files in ${props.conversationTitle}`}
      style={props.width ? { "--browser-panel-width": `${props.width}px` } : undefined}
    >
      <header class="file-preview-header conversation-files-header">
        <Folder class="file-preview-file-icon" aria-hidden="true" />
        <h2>Files</h2>
        <Show when={!props.loading}>
          <span class="conversation-files-summary">
            {fileCountLabel(props.files.length)} · chat {formatFileSize(props.chatBytes)}
          </span>
        </Show>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label="Close files"
          onClick={() => props.onClose()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class="conversation-files-content">
        <FileList
          label={`Files in ${props.conversationTitle}`}
          files={props.files}
          agents={props.agents}
          showConversation={false}
          compact
          groupByDay
          groupHeadingLevel={3}
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          now={props.now}
          canDelete={props.canDelete}
          emptyTitle="No files in this chat"
          emptyDescription="Files you attach and files the agent makes show here."
          onPreview={props.onPreviewFile}
          onAction={props.onFileAction}
        />
      </div>
    </aside>
  );
}
