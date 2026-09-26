import { Button, FolderOpen, IconButton, Skeleton } from "@openbot/ui";
import { SettingsPanelHeader } from "@openbot/ui/components/SettingsPanel";
import { currentText, useText } from "@openbot/ui/text";
import { createMemo, createUniqueId, For, Show } from "solid-js";
import { FileList } from "./FileList";
import {
  type ConversationStorageRow,
  fileCountLabel,
  type StorageBreakdown,
  type StoredFileAction,
  type StoredFileRow,
  storageBytes,
  storageTotal,
} from "./files-view";

export interface AgentFilesViewProps {
  agentName: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** This agent's share of each storage location. */
  breakdown: readonly StorageBreakdown[];
  conversations: readonly ConversationStorageRow[];
  files: readonly StoredFileRow[];
  now?: Date;
  onBack: () => void;
  onClose: () => void;
  /** Opens the workspace folder in the file manager. Leave it out for a remote server: the folder is on the host. */
  onOpenWorkspace?: () => void;
  /** The viewer can delete this agent's files. */
  canDelete?: boolean;
  onOpenConversation: (conversationId: string) => void;
  onPreviewFile: (file: StoredFileRow) => void;
  onFileAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}

const CHAT_ROWS = 4;

/** The value on the Files row of the agent settings, such as "1.4 GB". */
export function agentFilesLinkValue(breakdown: readonly StorageBreakdown[]): string {
  return currentText().format.fileSize(storageTotal(breakdown));
}

/**
 * Agent settings > Files: what this agent keeps on the computer. It opens over the settings like
 * Routines and uses the same header, so Back returns to the settings.
 */
export function AgentFilesView(props: AgentFilesViewProps) {
  const { t, format } = useText();
  const headingId = `agent-files-${createUniqueId()}`;
  const tiles = createMemo(() => [
    {
      label: t("files.agent.workspace"),
      bytes: storageBytes(props.breakdown, "workspaces"),
      openable: Boolean(props.onOpenWorkspace),
    },
    { label: t("files.category.attachments"), bytes: storageBytes(props.breakdown, "attachments") },
    { label: t("files.category.generated"), bytes: storageBytes(props.breakdown, "generated") },
    { label: t("files.category.chats"), bytes: storageBytes(props.breakdown, "chats") },
  ]);
  const chats = createMemo(() =>
    [...props.conversations].sort((left, right) => right.bytes - left.bytes).slice(0, CHAT_ROWS),
  );

  return (
    <div class="agent-files-view">
      <SettingsPanelHeader
        title={t("files.agent.title")}
        onBack={props.onBack}
        backLabel={t("files.agent.back")}
        onClose={props.onClose}
        closeLabel={t("files.agent.close")}
      />
      <div class="agent-files-body">
        <section class="agent-files-summary" aria-labelledby={`${headingId}-total`}>
          <div>
            <h3 id={`${headingId}-total`} class="agent-files-total-label">
              {t("files.agent.uses", { name: props.agentName })}
            </h3>
            <Show when={!props.loading} fallback={<Skeleton class="agent-files-total-skeleton" />}>
              <p class="agent-files-total">{format.fileSize(storageTotal(props.breakdown))}</p>
            </Show>
          </div>
          <dl class="agent-files-tiles">
            <For each={tiles()}>
              {(tile) => (
                <div class="agent-files-tile">
                  <dt>
                    <span class="agent-files-tile-label">{tile.label}</span>
                    <Show when={tile.openable}>
                      <IconButton
                        variant="ghost"
                        size="icon-xs"
                        class="agent-files-tile-action"
                        label={t("files.agent.openWorkspace")}
                        onClick={() => props.onOpenWorkspace?.()}
                      >
                        <FolderOpen aria-hidden="true" />
                      </IconButton>
                    </Show>
                  </dt>
                  <dd>
                    <Show when={!props.loading} fallback={<Skeleton class="agent-files-tile-skeleton" />}>
                      {format.fileSize(tile.bytes)}
                    </Show>
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </section>

        <Show when={!props.loading && chats().length > 0}>
          <section class="agent-files-section" aria-labelledby={`${headingId}-chats`}>
            <h3 id={`${headingId}-chats`} class="storage-section-heading">
              {t("files.agent.chatsBySize")}
            </h3>
            <ul class="storage-rows">
              <For each={chats()}>
                {(chat) => (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      class="storage-row"
                      aria-label={t("files.storage.rowLabel", { name: chat.title, size: format.fileSize(chat.bytes) })}
                      onClick={() => props.onOpenConversation(chat.id)}
                    >
                      <span class="storage-row-copy">
                        <span class="storage-row-title" title={chat.title}>
                          {chat.title}
                        </span>
                        <span class="storage-row-meta">
                          {fileCountLabel(chat.fileCount, t)} · {t("files.messageCount", { count: chat.messageCount })}
                        </span>
                      </span>
                      <span class="storage-row-size">{format.fileSize(chat.bytes)}</span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <FileList
          label={t("files.agent.listLabel", { name: props.agentName })}
          files={props.files}
          compact
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          now={props.now}
          canDelete={props.canDelete}
          emptyTitle={t("files.list.emptyTitle")}
          emptyDescription={t("files.agent.emptyDescription", { name: props.agentName })}
          onPreview={props.onPreviewFile}
          onAction={props.onFileAction}
        />
      </div>
    </div>
  );
}
