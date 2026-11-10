import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  buttonVariants,
  Check,
  ConfirmDialog,
  Download,
  DropdownMenu,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Input,
  MessageCircle,
  RefreshCw,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Trash2,
  TriangleAlert,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, For, Show } from "solid-js";
import { fileBadge } from "../conversation/AttachmentCards";
import { attachmentReferenceBadge, attachmentReferenceTone } from "../conversation/AttachmentReference";
import {
  FILE_SORTS,
  FILE_TYPE_FILTERS,
  type FileQuery,
  type FileSort,
  type FileTypeFilter,
  fileCountLabel,
  fileDayLabel,
  fileTypeCounts,
  groupFilesByDay,
  queryFiles,
  type StoredFileAction,
  type StoredFileRow,
} from "./files-view";

export interface FileListProps {
  /** Accessible name of the list, such as "Files in Chief". */
  label: string;
  files: readonly StoredFileRow[];
  /** Names the agent on each row. Leave it out where the list already belongs to one agent. */
  agents?: readonly AgentProfile[] | undefined;
  /** Show the chat each file belongs to. Off in the chat's own panel. */
  showConversation?: boolean;
  /** Narrow layout for the chat side panel: filters scroll, rows drop the chat column. */
  compact?: boolean;
  /** Day headings between rows. Applies to the "Newest" order only. */
  groupByDay?: boolean;
  /** Level of the day headings: one below the nearest heading of the caller. Default 4. */
  groupHeadingLevel?: 3 | 4;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  initialQuery?: Partial<FileQuery>;
  /**
   * The search, type and order that the caller owns, such as the Library page. The list then shows no
   * search, filters or count of its own.
   */
  query?: FileQuery | undefined;
  /** The clock for day labels, so a story does not depend on the day it runs. */
  now?: Date | undefined;
  emptyTitle?: string;
  emptyDescription?: string;
  /** The viewer can delete files. A row also needs `deletable`. Off for a member of a remote server. */
  canDelete?: boolean | undefined;
  /** Lets the caller select rows, such as the Library for a delete of many files. */
  selection?: FileSelection | undefined;
  onPreview: (file: StoredFileRow) => void;
  onAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}

/** The selected files of a list that the caller owns. */
export interface FileSelection {
  /** A click selects the file instead of opening it, and each row shows its mark. */
  active: boolean;
  isSelected: (file: StoredFileRow) => boolean;
  canSelect: (file: StoredFileRow) => boolean;
  /** A click on a row in selection mode, or a Command, Control or Shift click in any mode. */
  onToggle: (file: StoredFileRow, event: MouseEvent) => void;
}

/** Command, Control or Shift starts a selection, as in Finder and Explorer. */
export function isSelectClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}

const LOADING_ROWS = [0, 1, 2, 3, 4];

/**
 * The file browser every Files surface shares: Storage in Settings, an agent's Files, and a chat's
 * Files panel. It owns the search, type filter and order; the caller owns the data and every action.
 */
export function FileList(props: FileListProps) {
  const { t, format } = useText();
  const [ownQuery, setQuery] = createStore<FileQuery>({
    search: props.initialQuery?.search ?? "",
    type: props.initialQuery?.type ?? "all",
    sort: props.initialQuery?.sort ?? "newest",
  });
  const query = () => props.query ?? ownQuery;
  const [pendingDelete, setPendingDelete] = createSignal<StoredFileRow | null>(null);
  const now = () => props.now ?? new Date();
  const labelOf = (key: AppTextKey | undefined) => (key ? t(key) : undefined);
  const searched = createMemo(() => queryFiles(props.files, { ...query(), type: "all" }));
  const counts = createMemo(() => fileTypeCounts(searched()));
  const visible = createMemo(() => queryFiles(props.files, { ...query() }));
  const groups = createMemo(() =>
    props.groupByDay && query().sort === "newest"
      ? groupFilesByDay(visible(), now(), t, format)
      : [{ key: "all", label: "", files: visible() }],
  );
  const filtered = () => !props.query && (ownQuery.search.trim() !== "" || ownQuery.type !== "all");
  const agentName = (agentId: string | null) =>
    agentId ? (props.agents?.find((agent) => agent.id === agentId)?.name ?? null) : null;

  const clearFilters = () =>
    setQuery((draft) => {
      draft.search = "";
      draft.type = "all";
    });

  return (
    <section class="file-list" data-compact={props.compact ? "true" : undefined} aria-label={props.label}>
      <Show when={!props.query}>
        <div class="file-list-toolbar">
          <FileSearch
            label={t("files.list.search")}
            value={ownQuery.search}
            onChange={(value) =>
              setQuery((draft) => {
                draft.search = value;
              })
            }
          />
          <Select<FileSort>
            options={FILE_SORTS.map((sort) => sort.value)}
            value={ownQuery.sort}
            onChange={(value) => {
              if (value)
                setQuery((draft) => {
                  draft.sort = value;
                });
            }}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {labelOf(FILE_SORTS.find((sort) => sort.value === itemProps.item.rawValue)?.label)}
              </SelectItem>
            )}
          >
            <SelectTrigger size="sm" class="file-list-sort" aria-label={t("files.list.sort")}>
              <SelectValue<FileSort>>
                {(selection) => labelOf(FILE_SORTS.find((sort) => sort.value === selection.selectedOption())?.label)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <FileTypeFilters
          counts={counts()}
          value={ownQuery.type}
          onChange={(type) =>
            setQuery((draft) => {
              draft.type = type;
            })
          }
        />
      </Show>

      <FileListStatus
        loading={props.loading}
        error={props.error}
        onRetry={props.onRetry}
        empty={props.files.length === 0}
        emptyTitle={props.emptyTitle}
        emptyDescription={props.emptyDescription}
      >
        <Show when={visible().length > 0} fallback={<FileNoMatches filtered={filtered()} onClear={clearFilters} />}>
          <Show when={!props.query}>
            <p class="file-list-summary" aria-live="polite">
              {fileCountLabel(visible().length, t)} ·{" "}
              {format.fileSize(visible().reduce((sum, file) => sum + file.size, 0))}
            </p>
          </Show>
          <For each={groups()}>
            {(group) => (
              <div class="file-list-group">
                <Show when={group.label}>
                  <Dynamic component={props.groupHeadingLevel === 3 ? "h3" : "h4"} class="file-list-group-heading">
                    {group.label}
                  </Dynamic>
                </Show>
                <ul class="file-list-rows">
                  <For each={group.files}>
                    {(file) => (
                      <FileRow
                        file={file}
                        agentName={agentName(file.agentId)}
                        showConversation={props.showConversation !== false && !props.compact}
                        canDelete={props.canDelete === true && file.deletable}
                        selection={props.selection}
                        dateLabel={
                          group.label
                            ? format.date(new Date(file.createdAt), {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : fileDayLabel(file.createdAt, now(), t, format)
                        }
                        onPreview={() => props.onPreview(file)}
                        onAction={(action) => {
                          if (action === "delete") setPendingDelete(file);
                          else void props.onAction(file, action);
                        }}
                      />
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </Show>
      </FileListStatus>

      <FileDeleteDialog
        file={pendingDelete()}
        onClose={() => setPendingDelete(null)}
        onDelete={(file) => props.onAction(file, "delete")}
      />
    </section>
  );
}

/** The search box of a file list. */
export function FileSearch(props: { label: string; value: string; onChange: (value: string) => void; class?: string }) {
  return (
    <div class={props.class ? `file-list-search ${props.class}` : "file-list-search"}>
      <Search class="file-list-search-icon" aria-hidden="true" />
      <Input
        type="search"
        size="sm"
        class="file-list-search-input"
        placeholder={props.label}
        aria-label={props.label}
        value={props.value}
        onValueChange={props.onChange}
      />
    </div>
  );
}

/** One chip for each file type that has files, with its count. "All" always shows. */
export function FileTypeFilters(props: {
  counts: Record<FileTypeFilter, number>;
  value: FileTypeFilter;
  onChange: (type: FileTypeFilter) => void;
}) {
  const { t } = useText();
  return (
    <fieldset class="file-list-filters" aria-label={t("files.list.type")}>
      <For each={FILE_TYPE_FILTERS.filter((filter) => filter.value === "all" || props.counts[filter.value] > 0)}>
        {(filter) => (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            class="file-list-filter"
            aria-pressed={props.value === filter.value ? "true" : "false"}
            data-cuelume-tap="select"
            onClick={() => props.onChange(filter.value)}
          >
            {t(filter.label)}
            <span class="file-list-filter-count">{props.counts[filter.value]}</span>
          </Button>
        )}
      </For>
    </fieldset>
  );
}

/** The message when no file matches the search and type. "Clear filters" shows only when a filter is set. */
export function FileNoMatches(props: { filtered: boolean; onClear: () => void }) {
  const { t } = useText();
  return (
    <div class="file-list-message">
      <p class="file-list-message-title">{t("files.list.noMatches")}</p>
      <Show when={props.filtered}>
        <Button type="button" size="sm" variant="secondary" onClick={props.onClear}>
          {t("files.list.clearFilters")}
        </Button>
      </Show>
    </div>
  );
}

/** The loading, error and empty states of a file list. The children show when there are files. */
export function FileListStatus(props: {
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  empty: boolean;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  children: JSX.Element;
}) {
  const { t } = useText();
  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="file-list-rows" role="status" aria-busy="true" aria-label={t("files.list.loading")}>
          <For each={LOADING_ROWS}>{() => <Skeleton class="file-list-skeleton" />}</For>
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <div class="file-list-message" role="alert">
            <TriangleAlert class="file-list-message-icon" data-tone="danger" aria-hidden="true" />
            <p class="file-list-message-title">{t("files.list.loadFailed")}</p>
            <p class="file-list-message-description">{props.error}</p>
            <Show when={props.onRetry}>
              <Button type="button" size="sm" variant="secondary" onClick={() => props.onRetry?.()}>
                <RefreshCw class="files-button-icon" aria-hidden="true" />
                {t("common.tryAgain")}
              </Button>
            </Show>
          </div>
        }
      >
        <Show
          when={!props.empty}
          fallback={
            <div class="file-list-message">
              <p class="file-list-message-title">{props.emptyTitle ?? t("files.list.emptyTitle")}</p>
              <p class="file-list-message-description">{props.emptyDescription ?? t("files.list.emptyDescription")}</p>
            </div>
          }
        >
          {props.children}
        </Show>
      </Show>
    </Show>
  );
}

/**
 * Asks before a file is deleted, or before a file that is gone is removed from the list. The dialog
 * stays open with the error when the delete fails.
 */
export function FileDeleteDialog(props: {
  file: StoredFileRow | null;
  onClose: () => void;
  onDelete: (file: StoredFileRow) => void | Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  const available = () => props.file?.status === "available";
  const close = () => {
    setError(null);
    props.onClose();
  };
  async function confirm(): Promise<void> {
    const file = props.file;
    if (!file) return;
    setError(null);
    try {
      await props.onDelete(file);
      close();
    } catch (caught) {
      setError(errorMessage(caught, t("files.delete.failed")));
    }
  }
  return (
    <ConfirmDialog
      open={props.file !== null}
      onCancel={close}
      onConfirm={confirm}
      title={available() ? t("files.delete.titleAvailable") : t("files.delete.titleRemoved")}
      description={
        available()
          ? t("files.delete.descriptionAvailable", { name: props.file?.name ?? "" })
          : t("files.delete.descriptionRemoved", { name: props.file?.name ?? "" })
      }
      confirmLabel={available() ? t("common.delete") : t("common.remove")}
      pendingLabel={available() ? t("files.delete.deleting") : t("files.delete.removing")}
      error={error() ?? undefined}
    />
  );
}

/** The check mark of a selectable file. The control that selects the file has the state; the mark only shows it. */
export function FileSelectionMark(props: { selected: boolean; class?: string }) {
  return (
    <span
      class={props.class ? `file-select-mark ${props.class}` : "file-select-mark"}
      data-selected={props.selected ? "true" : undefined}
      aria-hidden="true"
    >
      <Check />
    </span>
  );
}

function FileRow(props: {
  file: StoredFileRow;
  agentName: string | null;
  showConversation: boolean;
  canDelete: boolean;
  selection: FileSelection | undefined;
  dateLabel: string;
  onPreview: () => void;
  onAction: (action: StoredFileAction) => void;
}) {
  const { t, format } = useText();
  const available = () => props.file.status === "available";
  const selecting = () => props.selection?.active === true;
  const selectable = () => props.selection?.canSelect(props.file) === true;
  const selected = () => props.selection?.isSelected(props.file) === true;
  function click(event: MouseEvent): void {
    if (props.selection && selectable() && (selecting() || isSelectClick(event))) {
      props.selection.onToggle(props.file, event);
      return;
    }
    if (!selecting()) props.onPreview();
  }
  const meta = () =>
    [
      format.fileSize(props.file.size),
      props.showConversation ? props.file.conversation?.title : null,
      props.agentName,
      props.dateLabel,
    ].filter(Boolean);
  const rowLabel = () => {
    if (selecting()) return props.file.name;
    return canPreviewAttachment(props.file)
      ? t("attachment.preview", { name: props.file.name })
      : t("attachment.open", { name: props.file.name });
  };

  return (
    <li
      class="file-row"
      data-status={props.file.status}
      data-selected={selected() ? "true" : undefined}
      data-file-id={props.file.id}
    >
      <Button
        type="button"
        variant="ghost"
        class="file-row-main"
        disabled={selecting() ? !selectable() : !available()}
        aria-pressed={selecting() ? (selected() ? "true" : "false") : undefined}
        aria-label={rowLabel()}
        onClick={click}
      >
        <Show when={selecting()}>
          <FileSelectionMark selected={selected()} />
        </Show>
        <FileVisual file={props.file} />
        <span class="file-row-copy">
          <span class="file-row-name" title={props.file.name}>
            {props.file.name}
          </span>
          <span class="file-row-meta">
            <For each={meta()}>
              {(part, index) => (
                <>
                  <Show when={index() > 0}>
                    <span aria-hidden="true"> · </span>
                  </Show>
                  <span class="file-row-meta-part">{part}</span>
                </>
              )}
            </For>
          </span>
        </span>
      </Button>
      <FileStatusBadge status={props.file.status} />
      <Show when={!selecting()}>
        <FileRowMenu file={props.file} canDelete={props.canDelete} onAction={props.onAction} />
      </Show>
    </li>
  );
}

function FileVisual(props: { file: StoredFileRow }) {
  return (
    <Show
      when={props.file.previewKind === "image" && props.file.previewUrl && props.file.status === "available"}
      fallback={
        <span
          class="files-file-visual"
          data-file-tone={attachmentReferenceTone(props.file.name)}
          data-status={props.file.status}
          aria-hidden="true"
        >
          {attachmentReferenceBadge(props.file.name) ?? fileBadge(props.file)}
        </span>
      }
    >
      <span class="files-file-visual files-file-thumbnail" aria-hidden="true">
        <img src={props.file.previewUrl ?? ""} alt="" />
      </span>
    </Show>
  );
}

function FileStatusBadge(props: { status: StoredFileRow["status"] }) {
  const { t } = useText();
  return (
    <Show when={props.status !== "available"}>
      <Badge
        class="file-row-status"
        variant={
          props.status === "missing" ? "warning-light" : props.status === "failed" ? "destructive-light" : "info-light"
        }
      >
        {props.status === "missing"
          ? t("files.status.missing")
          : props.status === "failed"
            ? t("files.status.failed")
            : t("files.status.remote")}
      </Badge>
    </Show>
  );
}

/** The actions of one file. The items depend on where the file is. */
export function FileRowMenu(props: {
  file: StoredFileRow;
  canDelete: boolean;
  onAction: (action: StoredFileAction) => void;
  class?: string | undefined;
}) {
  const { t } = useText();
  const status = () => props.file.status;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ${props.class ?? "file-row-menu-trigger"}`}
        aria-label={t("files.action.moreActions", { name: props.file.name })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <Show when={status() === "available"}>
            <DropdownMenu.Item onSelect={() => props.onAction("open")}>
              <ExternalLink aria-hidden="true" />
              {t("common.open")}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => props.onAction("reveal")}>
              <FolderOpen aria-hidden="true" />
              {t("files.action.reveal")}
            </DropdownMenu.Item>
          </Show>
          <Show when={status() === "available" || status() === "remote"}>
            <DropdownMenu.Item onSelect={() => props.onAction("download")}>
              <Download aria-hidden="true" />
              {t("common.download")}
            </DropdownMenu.Item>
          </Show>
          <Show when={status() === "failed"}>
            <DropdownMenu.Item onSelect={() => props.onAction("retry")}>
              <RefreshCw aria-hidden="true" />
              {t("common.tryAgain")}
            </DropdownMenu.Item>
          </Show>
          <Show when={props.file.conversation && props.file.messageId}>
            <DropdownMenu.Item onSelect={() => props.onAction("show-in-chat")}>
              <MessageCircle aria-hidden="true" />
              {t("files.action.showInChat")}
            </DropdownMenu.Item>
          </Show>
          <Show when={props.canDelete}>
            <DropdownMenu.Separator />
            <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onAction("delete")}>
              <Trash2 aria-hidden="true" />
              {status() === "available" ? t("common.delete") : t("common.remove")}
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
