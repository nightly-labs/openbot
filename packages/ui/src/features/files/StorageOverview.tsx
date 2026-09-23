import { CLEARABLE_STORAGE_CATEGORIES, type ClearableStorageCategory } from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import {
  Button,
  ChevronRight,
  ConfirmDialog,
  HardDrive,
  Progress,
  RefreshCw,
  Skeleton,
  TriangleAlert,
} from "@openbot/ui";
import { SettingsBackIcon } from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { formatFileSize } from "../conversation/AttachmentCards";
import { FileList } from "./FileList";
import {
  type AgentStorageRow,
  type ConversationStorageRow,
  chatCountLabel,
  fileCountLabel,
  STORAGE_CATEGORY_LABELS,
  type StorageBreakdown,
  type StoredFileAction,
  type StoredFileRow,
  sharePercent,
  storageGroupTotals,
  storageTotal,
} from "./files-view";
import { StorageUsageBar } from "./StorageUsageBar";

export type StorageScanState = "scanning" | "ready" | "error";

export interface StorageOverviewProps {
  /** The computer the numbers belong to, such as "This Mac" or a server name. */
  hostName: string;
  state: StorageScanState;
  /** 0–100 while `state` is "scanning". Leave it out when the scan cannot tell. */
  scanProgress?: number;
  error?: string | null;
  /** ISO time of the last completed scan. */
  scannedAt?: string | null;
  breakdown: readonly StorageBreakdown[];
  /** Free space on the disk that holds the OpenBot folder. */
  freeBytes?: number | null;
  agents: readonly AgentProfile[];
  agentUsage: readonly AgentStorageRow[];
  conversations: readonly ConversationStorageRow[];
  files: readonly StoredFileRow[];
  now?: Date;
  onRescan: () => void;
  onOpenAgent: (agentId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  /** The viewer can clear caches and delete files. Off for a member of a remote server. */
  canManage?: boolean;
  onClear: (category: ClearableStorageCategory) => void | Promise<void>;
  onPreviewFile: (file: StoredFileRow) => void;
  onFileAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}

const LARGEST_CHATS = 5;

/**
 * The Storage page: how much space OpenBot takes on one computer, which agents and chats take it,
 * every file in one list, and what can go without losing work. Chats and workspaces are never
 * cleared from here; the user deletes them where they live.
 */
export function StorageOverview(props: StorageOverviewProps) {
  const headingId = `storage-${createUniqueId()}`;
  const [showFiles, setShowFiles] = createSignal(false);
  const total = createMemo(() => storageTotal(props.breakdown));
  const groups = createMemo(() => storageGroupTotals(props.breakdown));
  const removable = createMemo(() =>
    props.breakdown.flatMap((entry) =>
      entry.removable && entry.bytes > 0 && isOneOf(CLEARABLE_STORAGE_CATEGORIES, entry.category)
        ? [{ category: entry.category, bytes: entry.bytes }]
        : [],
    ),
  );
  const removableBytes = () => removable().reduce((sum, entry) => sum + entry.bytes, 0);
  const agentRows = createMemo(() =>
    [...props.agentUsage]
      .sort((left, right) => right.bytes - left.bytes)
      .map((row) => ({ ...row, agent: props.agents.find((agent) => agent.id === row.agentId) })),
  );
  const largestAgentBytes = () => agentRows()[0]?.bytes ?? 0;
  const largestChats = createMemo(() =>
    [...props.conversations].sort((left, right) => right.bytes - left.bytes).slice(0, LARGEST_CHATS),
  );
  const filesBytes = () => props.files.reduce((sum, file) => sum + file.size, 0);
  const agentName = (agentId: string) => props.agents.find((agent) => agent.id === agentId)?.name ?? "Removed agent";

  return (
    <Show
      when={!showFiles()}
      fallback={
        <div class="storage-overview" data-view="files">
          <header class="storage-subview-header">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="storage-subview-back"
              aria-label="Back to storage"
              onClick={() => setShowFiles(false)}
            >
              <SettingsBackIcon />
            </Button>
            <h3>All files</h3>
          </header>
          <FileList
            label={`All files on ${props.hostName}`}
            files={props.files}
            agents={props.agents}
            showConversation
            groupByDay
            now={props.now}
            canDelete={props.canManage}
            onPreview={props.onPreviewFile}
            onAction={props.onFileAction}
          />
        </div>
      }
    >
      <div class="storage-overview" aria-busy={props.state === "scanning" ? "true" : undefined}>
        <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
          <div class="storage-summary-heading">
            <div>
              <h3 id={`${headingId}-summary`} class="storage-summary-label">
                OpenBot on {props.hostName}
              </h3>
              <Show
                when={props.state !== "scanning" || total() > 0}
                fallback={<Skeleton class="storage-summary-total-skeleton" />}
              >
                <Show when={props.state !== "error" || total() > 0}>
                  <p class="storage-summary-total">{formatFileSize(total())}</p>
                </Show>
              </Show>
              <p class="storage-summary-caption">
                <StorageCaption
                  state={props.state}
                  scannedAt={props.scannedAt}
                  freeBytes={props.freeBytes}
                  now={props.now}
                />
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={props.state === "scanning"}
              onClick={() => props.onRescan()}
            >
              <RefreshCw class="files-button-icon" aria-hidden="true" />
              {props.state === "scanning" ? "Measuring…" : "Measure again"}
            </Button>
          </div>

          <Show when={props.state === "scanning"}>
            <Progress
              class="storage-scan-progress"
              value={props.scanProgress ?? 0}
              indeterminate={props.scanProgress === undefined}
              aria-label="Measuring storage"
            />
          </Show>

          <Show when={props.state === "error"}>
            <div class="storage-message" role="alert">
              <TriangleAlert class="storage-message-icon" aria-hidden="true" />
              <div>
                <p class="storage-message-title">Storage could not be measured</p>
                <p class="storage-message-description">{props.error}</p>
              </div>
            </div>
          </Show>

          <Show when={groups().length > 0}>
            <StorageUsageBar groups={groups()} label="Storage by type" />
          </Show>
          <Show when={props.state === "ready" && total() === 0}>
            <div class="storage-message">
              <HardDrive class="storage-message-icon" aria-hidden="true" />
              <div>
                <p class="storage-message-title">Nothing stored yet</p>
                <p class="storage-message-description">
                  Agent workspaces, chat files and chat history show here when you start to use OpenBot.
                </p>
              </div>
            </div>
          </Show>
        </section>

        <Show when={agentRows().length > 0}>
          <section class="storage-section" aria-labelledby={`${headingId}-agents`}>
            <h3 id={`${headingId}-agents`} class="storage-section-heading">
              Agents
            </h3>
            <ul class="storage-rows">
              <For each={agentRows()}>
                {(row) => (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      class="storage-row"
                      aria-label={`${row.agent?.name ?? "Removed agent"}, ${formatFileSize(row.bytes)}`}
                      onClick={() => props.onOpenAgent(row.agentId)}
                    >
                      <AgentAvatar
                        agent={row.agent}
                        seed={row.agent ? undefined : row.agentId}
                        class="storage-row-avatar"
                      />
                      <span class="storage-row-copy">
                        <span class="storage-row-title">{row.agent?.name ?? "Removed agent"}</span>
                        <span class="storage-row-meta">
                          {fileCountLabel(row.fileCount)} · {chatCountLabel(row.conversationCount)}
                        </span>
                      </span>
                      <span class="storage-row-share" aria-hidden="true">
                        <span
                          class="storage-row-share-fill"
                          style={{
                            width: `${largestAgentBytes() > 0 ? (row.bytes / largestAgentBytes()) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <span class="storage-row-size">
                        {formatFileSize(row.bytes)}
                        <span class="storage-row-percent">{sharePercent(row.bytes, total())}%</span>
                      </span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={largestChats().length > 0}>
          <section class="storage-section" aria-labelledby={`${headingId}-chats`}>
            <h3 id={`${headingId}-chats`} class="storage-section-heading">
              Largest chats
            </h3>
            <ul class="storage-rows">
              <For each={largestChats()}>
                {(chat) => (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      class="storage-row"
                      aria-label={`${chat.title}, ${formatFileSize(chat.bytes)}`}
                      onClick={() => props.onOpenConversation(chat.id)}
                    >
                      <span class="storage-row-copy">
                        <span class="storage-row-title" title={chat.title}>
                          {chat.title}
                        </span>
                        <span class="storage-row-meta">
                          {agentName(chat.agentId)} · {fileCountLabel(chat.fileCount)} · {chat.messageCount}{" "}
                          {chat.messageCount === 1 ? "message" : "messages"}
                        </span>
                      </span>
                      <span class="storage-row-size">{formatFileSize(chat.bytes)}</span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={props.files.length > 0}>
          <section class="storage-section" aria-labelledby={`${headingId}-files`}>
            <h3 id={`${headingId}-files`} class="storage-section-heading">
              Files
            </h3>
            <ul class="storage-rows">
              <li>
                <Button type="button" variant="ghost" class="storage-row" onClick={() => setShowFiles(true)}>
                  <span class="storage-row-copy">
                    <span class="storage-row-title">All files</span>
                    <span class="storage-row-meta">Files of all agents and chats</span>
                  </span>
                  <span class="storage-row-size">
                    {formatFileSize(filesBytes())}
                    <span class="storage-row-percent">{fileCountLabel(props.files.length)}</span>
                  </span>
                  <ChevronRight class="storage-row-chevron" aria-hidden="true" />
                </Button>
              </li>
            </ul>
          </section>
        </Show>

        <Show when={props.canManage && removable().length > 0}>
          <StorageCleanup
            entries={removable()}
            totalBytes={removableBytes()}
            disabled={props.state === "scanning"}
            onClear={props.onClear}
          />
        </Show>
      </div>
    </Show>
  );
}

function StorageCaption(props: {
  state: StorageScanState;
  scannedAt?: string | null;
  freeBytes?: number | null;
  now?: Date;
}) {
  const parts = () => {
    const result: string[] = [];
    if (props.state === "scanning") result.push("Measuring the OpenBot folder…");
    else if (props.scannedAt) result.push(`Measured ${relativeTime(props.scannedAt, props.now ?? new Date())}`);
    if (props.freeBytes != null) result.push(`${formatFileSize(props.freeBytes)} free on this disk`);
    return result.join(" · ");
  };
  return <>{parts()}</>;
}

function relativeTime(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface CleanupEntry {
  category: ClearableStorageCategory;
  bytes: number;
}

const CLEANUP_DESCRIPTIONS: Record<ClearableStorageCategory, string> = {
  caches: "Copies of server files. OpenBot downloads them again when you open them.",
  logs: "Diagnostic logs. New logs start at once.",
};

function StorageCleanup(props: {
  entries: readonly CleanupEntry[];
  totalBytes: number;
  disabled: boolean;
  onClear: (category: ClearableStorageCategory) => void | Promise<void>;
}) {
  const headingId = `storage-cleanup-${createUniqueId()}`;
  const [pending, setPending] = createSignal<CleanupEntry | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function confirm(): Promise<void> {
    const entry = pending();
    if (!entry) return;
    setError(null);
    try {
      await props.onClear(entry.category);
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear the data.");
    }
  }

  return (
    <section class="storage-section" aria-labelledby={headingId}>
      <div class="storage-section-heading-row">
        <h3 id={headingId} class="storage-section-heading">
          Clean up
        </h3>
        <span class="storage-section-aside">{formatFileSize(props.totalBytes)} can be cleared</span>
      </div>
      <ul class="storage-rows storage-cleanup-rows">
        <For each={props.entries}>
          {(entry) => (
            <li class="storage-cleanup-row">
              <span class="storage-row-copy">
                <span class="storage-row-title">{STORAGE_CATEGORY_LABELS[entry.category]}</span>
                <span class="storage-row-meta">{CLEANUP_DESCRIPTIONS[entry.category]}</span>
              </span>
              <span class="storage-row-size">{formatFileSize(entry.bytes)}</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={props.disabled}
                aria-label={`Clear ${STORAGE_CATEGORY_LABELS[entry.category]}`}
                onClick={() => {
                  setError(null);
                  setPending(entry);
                }}
              >
                Clear
              </Button>
            </li>
          )}
        </For>
      </ul>
      <ConfirmDialog
        open={pending() !== null}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
        title={`Clear ${STORAGE_CATEGORY_LABELS[pending()?.category ?? "caches"].toLocaleLowerCase()}?`}
        description={`This frees ${formatFileSize(pending()?.bytes ?? 0)}. ${CLEANUP_DESCRIPTIONS[pending()?.category ?? "caches"]}`}
        confirmLabel="Clear"
        pendingLabel="Clearing…"
        error={error() ?? undefined}
      />
    </section>
  );
}
