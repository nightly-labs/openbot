import { Button, LayoutGrid, List, toast } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { fileBadge } from "../conversation/AttachmentCards";
import { attachmentReferenceBadge, attachmentReferenceTone } from "../conversation/AttachmentReference";
import { ImageLightbox, type ImageLightboxOpening, isLightboxImage } from "../conversation/ImageLightbox";
import {
  FileDeleteDialog,
  FileList,
  FileListStatus,
  FileNoMatches,
  FileRowMenu,
  FileSearch,
  type FileSelection,
  FileSelectionMark,
  FileTypeFilters,
  isSelectClick,
} from "./FileList";
import {
  type FileTypeFilter,
  fileTypeCounts,
  queryFiles,
  type StoredFileAction,
  type StoredFileRow,
} from "./files-view";
import { type LibraryBatchAction, type LibraryPillStep, LibrarySelectionPill } from "./LibrarySelectionPill";
import { createMarqueeSelection } from "./marquee-selection";

export interface LibraryPageProps {
  /** The stored files of the server. A file that is gone from the disk does not show. */
  files: readonly StoredFileRow[];
  /** Names the agent of a file that has no chat. */
  agents?: readonly AgentProfile[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  /** The viewer can delete files. A file also needs `deletable`. Off for a member of a remote server. */
  canDelete?: boolean | undefined;
  /** The clock for the day headings of the list, so a story does not depend on the day it runs. */
  now?: Date | undefined;
  /** The window draws the macOS window controls over the top start corner, so the image viewer leaves room. */
  macWindowControls?: boolean | undefined;
  /** Opens a file that is not a picture: in the file viewer, or in its default app. */
  onOpen: (file: StoredFileRow, origin: HTMLElement | undefined) => void;
  onAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
  /**
   * Deletes the selected files one at a time, tells `onProgress` how many are done, and resolves with
   * the number that could not be deleted. Without it, the selection has no Delete.
   */
  onDeleteFiles?: BatchFileAction | undefined;
  /**
   * Puts the selected files in the Downloads folder, as `onDeleteFiles` does. Without it and without
   * `onDeleteFiles`, the page offers no selection.
   */
  onSaveFiles?: BatchFileAction | undefined;
}

export type BatchFileAction = (files: readonly StoredFileRow[], onProgress: (done: number) => void) => Promise<number>;

type LibraryView = "grid" | "list";

/** The files picked for a download or a delete. `anchor` is the last file clicked: Shift selects from it to the next one. */
interface LibrarySelection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

function isPicture(file: StoredFileRow): boolean {
  return isLightboxImage(file) && file.status !== "failed";
}

/**
 * The files and pictures of every agent and chat of a server, newest first. The grid shows each
 * picture and a card for each other file; the list shows the same files as rows. A picture opens in
 * the image viewer; the caller opens the other files. Selected files get a pill at the bottom with
 * Download and Delete; a drag over the files selects them.
 */
export function LibraryPage(props: LibraryPageProps) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const [type, setType] = createSignal<FileTypeFilter>("all");
  const [view, setView] = createSignal<LibraryView>("grid");
  const [pendingDelete, setPendingDelete] = createSignal<StoredFileRow | null>(null);
  const [lightbox, setLightbox] = createSignal<ImageLightboxOpening | null>(null);
  const thumbnails = new Map<string, HTMLElement>();
  const files = createMemo(() => props.files.filter((file) => file.status !== "missing"));
  const searched = createMemo(() => queryFiles(files(), { search: search(), type: "all", sort: "newest" }));
  const shown = createMemo(() => queryFiles(files(), { search: search(), type: type(), sort: "newest" }));
  const counts = createMemo(() => fileTypeCounts(searched()));
  const filtered = () => search().trim() !== "" || type() !== "all";
  const agentName = (agentId: string | null) =>
    agentId ? props.agents?.find((agent) => agent.id === agentId)?.name : undefined;
  const [selection, setSelection] = createSignal<LibrarySelection | null>(null);
  const [step, setStep] = createSignal<LibraryPillStep>({ kind: "actions" });
  // A file on this computer or on the server can be downloaded, so a member can select it too.
  const canSave = (file: StoredFileRow) =>
    props.onSaveFiles !== undefined && (file.status === "available" || file.status === "remote");
  const canDeleteFile = (file: StoredFileRow) =>
    props.canDelete === true && file.deletable && props.onDeleteFiles !== undefined;
  const canSelect = (file: StoredFileRow) => canSave(file) || canDeleteFile(file);
  const selecting = () => selection() !== null;
  const busy = () => step().kind === "working";
  const selectable = createMemo(() => shown().filter(canSelect));
  // A file that the search or type hides stays picked, but only the files on the page are acted on.
  const selected = createMemo(() => {
    const ids = selection()?.ids;
    return ids ? selectable().filter((file) => ids.has(file.id)) : [];
  });
  const savable = createMemo(() => selected().filter(canSave));
  const deletable = createMemo(() => selected().filter(canDeleteFile));
  const allSelected = () => selectable().length > 0 && selected().length === selectable().length;
  const isSelected = (file: StoredFileRow) => selection()?.ids.has(file.id) === true;
  const selectableFilesExist = () => files().some(canSelect);
  const pressed = (file: StoredFileRow) => (selecting() ? (isSelected(file) ? "true" : "false") : undefined);
  const pillOpen = () => selected().length > 0 || step().kind !== "actions";
  const pillCanDelete = () => props.canDelete === true && props.onDeleteFiles !== undefined;

  /** A new selection ends the delete question, because it asked about the files before. */
  function leaveConfirm(): void {
    if (step().kind === "confirm") setStep({ kind: "actions" });
  }

  function toggle(file: StoredFileRow, event: MouseEvent): void {
    if (!canSelect(file) || busy()) return;
    leaveConfirm();
    const current = selection() ?? { ids: new Set<string>(), anchor: null };
    const ids = new Set(current.ids);
    const list = shown();
    const from = current.anchor ? list.findIndex((candidate) => candidate.id === current.anchor) : -1;
    const to = list.indexOf(file);
    if (event.shiftKey && from >= 0 && to >= 0) {
      for (const candidate of list.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (canSelect(candidate)) ids.add(candidate.id);
      }
      setSelection({ ids, anchor: current.anchor });
      return;
    }
    if (ids.has(file.id)) ids.delete(file.id);
    else ids.add(file.id);
    setSelection({ ids, anchor: file.id });
  }

  function toggleAll(): void {
    leaveConfirm();
    // Only the files on the page change; a file that the search or type hides keeps its state.
    const ids = new Set(selection()?.ids);
    const clear = allSelected();
    for (const file of selectable()) {
      if (clear) ids.delete(file.id);
      else ids.add(file.id);
    }
    setSelection({ ids, anchor: null });
  }

  function stopSelecting(): void {
    if (busy()) return;
    setStep({ kind: "actions" });
    setSelection(null);
  }

  /** Runs a download or a delete on the files and shows its progress in the pill. A toast tells the result. */
  async function run(action: LibraryBatchAction, targets: readonly StoredFileRow[]): Promise<void> {
    const handler = action === "delete" ? props.onDeleteFiles : props.onSaveFiles;
    const total = targets.length;
    if (!handler || total === 0) return;
    setStep({ kind: "working", action, done: 0, total });
    let failed = total;
    try {
      failed = await handler(targets, (done) => setStep({ kind: "working", action, done, total }));
    } catch {
      // The handler counts each failed file; a rejection means that none was done.
    }
    setStep({ kind: "actions" });
    if (failed > 0) {
      toast.error(t(action === "delete" ? "files.delete.someFailed" : "files.library.saveFailed", { count: failed }));
      // The files that are gone leave the page. Those that failed stay selected, so the user can try again.
      return;
    }
    toast.success(t(action === "delete" ? "files.library.deleted" : "files.library.saved", { count: total }));
    if (action === "delete") setSelection(null);
  }

  // A drag over the files selects them. The selection before the drag comes back when Escape stops it.
  let beforeDrag: LibrarySelection | null = null;
  let dragBase: ReadonlySet<string> = new Set();
  const marquee = createMarqueeSelection({
    enabled: () => !busy() && lightbox() === null && selectableFilesExist(),
    onStart: (additive) => {
      beforeDrag = selection();
      dragBase = additive ? (beforeDrag?.ids ?? new Set()) : new Set();
      leaveConfirm();
    },
    onChange: (hits) => {
      const ids = new Set(dragBase);
      for (const file of selectable()) if (hits.has(file.id)) ids.add(file.id);
      // Most pointer moves do not change the files under the rectangle. Do not update every tile for them.
      const current = selection()?.ids;
      if (current && current.size === ids.size && [...ids].every((id) => current.has(id))) return;
      // A drag that touches no file before a selection started does not start one.
      setSelection(ids.size === 0 && beforeDrag === null ? null : { ids, anchor: beforeDrag?.anchor ?? null });
    },
    onCancel: () => setSelection(beforeDrag),
  });

  const listSelection: FileSelection = {
    get active() {
      return selecting();
    },
    isSelected,
    canSelect,
    onToggle: toggle,
  };

  // Escape answers No to the delete question, or ends the selection. An open dialog handles its own Escape first.
  createEffect(selecting, (on) => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || pendingDelete() !== null) return;
      if (step().kind === "confirm") setStep({ kind: "actions" });
      else stopSelecting();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  /** A click on a tile: selects in selection mode or with Command, Control or Shift, and opens otherwise. */
  function activate(file: StoredFileRow, event: MouseEvent & { currentTarget: HTMLElement }): void {
    if (canSelect(file) && (selecting() || isSelectClick(event))) toggle(file, event);
    else if (!selecting()) open(file, event.currentTarget);
  }

  function open(file: StoredFileRow, origin: HTMLElement | undefined): void {
    if (!isPicture(file)) {
      props.onOpen(file, origin);
      return;
    }
    const images = shown().filter(isPicture);
    setLightbox({ images, index: Math.max(0, images.indexOf(file)), origin });
  }

  function act(file: StoredFileRow, action: StoredFileAction): void {
    if (action === "delete") setPendingDelete(file);
    else void props.onAction(file, action);
  }

  function downloadImage(id: string): void {
    const file = files().find((candidate) => candidate.id === id);
    if (file) void props.onAction(file, "download");
  }

  function clearFilters(): void {
    setSearch("");
    setType("all");
  }

  return (
    <div class="library-frame" data-pill={pillOpen() ? "" : undefined}>
      <div class="library-page" ref={marquee.attach}>
        <header class="library-head">
          <h2 class="library-title">{t("files.library.title")}</h2>
          <div class="library-tools">
            <fieldset class="library-views" aria-label={t("files.library.view")} hidden={selecting()}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("files.library.grid")}
                aria-pressed={view() === "grid" ? "true" : "false"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("files.library.list")}
                aria-pressed={view() === "list" ? "true" : "false"}
                onClick={() => setView("list")}
              >
                <List aria-hidden="true" />
              </Button>
            </fieldset>
            <FileSearch
              class="library-search"
              label={t("files.library.search")}
              value={search()}
              onChange={setSearch}
            />
            <Show
              when={selecting()}
              fallback={
                <Show when={selectableFilesExist()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelection({ ids: new Set(), anchor: null })}
                  >
                    {t("files.library.select")}
                  </Button>
                </Show>
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selectable().length === 0 || busy()}
                onClick={toggleAll}
              >
                {allSelected() ? t("files.library.deselectAll") : t("files.library.selectAll")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy()} onClick={stopSelecting}>
                {t("common.done")}
              </Button>
            </Show>
          </div>
        </header>
        <FileListStatus
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          empty={files().length === 0}
        >
          <FileTypeFilters counts={counts()} value={type()} onChange={setType} />
          <Show when={shown().length > 0} fallback={<FileNoMatches filtered={filtered()} onClear={clearFilters} />}>
            <Show
              when={view() === "grid"}
              fallback={
                <FileList
                  label={t("files.library.title")}
                  files={files()}
                  agents={props.agents}
                  query={{ search: search(), type: type(), sort: "newest" }}
                  showConversation
                  groupByDay
                  groupHeadingLevel={3}
                  now={props.now}
                  canDelete={props.canDelete}
                  selection={listSelection}
                  onPreview={(file) => open(file, undefined)}
                  onAction={props.onAction}
                />
              }
            >
              <ul class="library-grid">
                <For each={shown()} keyed={(file) => file.id}>
                  {(file) => {
                    // The key is the id, so the tile keeps it until the tile goes.
                    const id = untrack(() => file().id);
                    onCleanup(() => thumbnails.delete(id));
                    return (
                      <li
                        class="library-tile"
                        data-kind={isPicture(file()) ? "image" : "file"}
                        data-selected={isSelected(file()) ? "true" : undefined}
                        data-file-id={id}
                      >
                        <Show
                          when={isPicture(file())}
                          fallback={
                            <Button
                              type="button"
                              variant="ghost"
                              class="library-file-card"
                              // As in the list, only a file on this computer opens.
                              disabled={selecting() ? !canSelect(file()) : file().status !== "available"}
                              aria-pressed={pressed(file())}
                              onClick={(event) => activate(file(), event)}
                            >
                              <span class="library-file-name">
                                <span
                                  class="files-file-visual"
                                  data-file-tone={attachmentReferenceTone(file().name)}
                                  aria-hidden="true"
                                >
                                  {attachmentReferenceBadge(file().name) ?? fileBadge(file())}
                                </span>
                                <span class="library-truncate">{file().name}</span>
                              </span>
                              <span class="library-file-source library-truncate">
                                {file().conversation?.title ?? agentName(file().agentId)}
                              </span>
                            </Button>
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            class="library-picture"
                            aria-label={file().name}
                            disabled={selecting() && !canSelect(file())}
                            aria-pressed={pressed(file())}
                            ref={(element) => thumbnails.set(id, element)}
                            onClick={(event) => activate(file(), event)}
                          >
                            <img src={file().previewUrl ?? ""} alt="" loading="lazy" draggable={false} />
                          </Button>
                        </Show>
                        <Show
                          when={selecting()}
                          fallback={
                            <FileRowMenu
                              file={file()}
                              canDelete={props.canDelete === true && file().deletable}
                              class="library-tile-menu"
                              onAction={(action) => act(file(), action)}
                            />
                          }
                        >
                          <Show when={canSelect(file())}>
                            <FileSelectionMark selected={isSelected(file())} class="library-tile-mark" />
                          </Show>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>
        </FileListStatus>
        <Show when={marquee.box()}>
          {(box) => (
            <div
              class="library-marquee"
              style={{
                left: `${box().left}px`,
                top: `${box().top}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
              aria-hidden="true"
            />
          )}
        </Show>
      </div>
      <LibrarySelectionPill
        open={pillOpen()}
        step={step()}
        count={selected().length}
        saveCount={savable().length}
        deleteCount={deletable().length}
        canDelete={pillCanDelete()}
        onSave={() => void run("save", savable())}
        onAskDelete={() => setStep({ kind: "confirm" })}
        onCancelDelete={() => setStep({ kind: "actions" })}
        onConfirmDelete={() => void run("delete", deletable())}
      />
      <FileDeleteDialog
        file={pendingDelete()}
        onClose={() => setPendingDelete(null)}
        onDelete={(file) => props.onAction(file, "delete")}
      />
      <Show when={lightbox()} keyed>
        {(opening) => (
          <ImageLightbox
            opening={opening}
            thumbnail={(image) => thumbnails.get(image.id)}
            onDownload={(image) => downloadImage(image.id)}
            macWindowControls={props.macWindowControls}
            stripLabel={t("files.library.images")}
            onClose={() => setLightbox(null)}
          />
        )}
      </Show>
    </div>
  );
}
