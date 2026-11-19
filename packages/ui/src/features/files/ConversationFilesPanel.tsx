import { Button, Folder, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { FileList } from "./FileList";
import { fileCountLabel, type StoredFileAction, type StoredFileRow } from "./files-view";

export interface ConversationFilesPanelProps {
  conversationTitle: string;
  files: readonly StoredFileRow[];
  chatBytes: number;
  agents?: readonly AgentProfile[];
  loading?: boolean;
  canDelete?: boolean;
  error?: string | null;
  onRetry?: () => void;
  width?: number;
  now?: Date;
  onClose: () => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onFileAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}

export function ConversationFilesPanel(props: ConversationFilesPanelProps) {
  const { t, format } = useText();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  return (
    <aside
      class="browser-panel conversation-files-panel"
      aria-label={t("files.conversation.label", { title: props.conversationTitle })}
      style={props.width ? { "--browser-panel-width": `${props.width}px` } : undefined}
    >
      <header class="file-preview-header conversation-files-header">
        <Folder class="file-preview-file-icon side-panel-pane-title" aria-hidden="true" />
        <h2 class="side-panel-pane-title">{t("files.conversation.title")}</h2>
        <Show when={!props.loading}>
          <span class="conversation-files-summary">
            {t("files.conversation.summary", {
              files: fileCountLabel(props.files.length, t),
              size: format.fileSize(props.chatBytes),
            })}
          </span>
        </Show>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("files.conversation.close")}
          data-cuelume-tap="close"
          onClick={() => props.onClose()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class={["conversation-files-content", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
        <div ref={fades.watch}>
          <FileList
            label={t("files.conversation.label", { title: props.conversationTitle })}
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
            emptyTitle={t("files.conversation.emptyTitle")}
            emptyDescription={t("files.conversation.emptyDescription")}
            onPreview={props.onPreviewFile}
            onAction={props.onFileAction}
          />
        </div>
      </div>
    </aside>
  );
}
