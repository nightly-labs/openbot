import { Button, LayoutGrid, List } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
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
  FileTypeFilters,
} from "./FileList";
import {
  type FileTypeFilter,
  fileTypeCounts,
  queryFiles,
  type StoredFileAction,
  type StoredFileRow,
} from "./files-view";

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
}

type LibraryView = "grid" | "list";

function isPicture(file: StoredFileRow): boolean {
  return isLightboxImage(file) && file.status !== "failed";
}

/**
 * The files and pictures of every agent and chat of a server, newest first. The grid shows each
 * picture and a card for each other file; the list shows the same files as rows. A picture opens in
 * the image viewer; the caller opens the other files.
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
    <div class="library-page">
      <header class="library-head">
        <h2 class="library-title">{t("files.library.title")}</h2>
        <div class="library-tools">
          <fieldset class="library-views" aria-label={t("files.library.view")}>
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
          <FileSearch class="library-search" label={t("files.library.search")} value={search()} onChange={setSearch} />
        </div>
      </header>
      <FileListStatus loading={props.loading} error={props.error} onRetry={props.onRetry} empty={files().length === 0}>
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
                    <li class="library-tile" data-kind={isPicture(file()) ? "image" : "file"}>
                      <Show
                        when={isPicture(file())}
                        fallback={
                          <Button
                            type="button"
                            variant="ghost"
                            class="library-file-card"
                            // As in the list, only a file on this computer opens.
                            disabled={file().status !== "available"}
                            onClick={(event) => open(file(), event.currentTarget)}
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
                          ref={(element) => thumbnails.set(id, element)}
                          onClick={(event) => open(file(), event.currentTarget)}
                        >
                          <img src={file().previewUrl ?? ""} alt="" loading="lazy" />
                        </Button>
                      </Show>
                      <FileRowMenu
                        file={file()}
                        canDelete={props.canDelete === true && file().deletable}
                        class="library-tile-menu"
                        onAction={(action) => act(file(), action)}
                      />
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </FileListStatus>
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
