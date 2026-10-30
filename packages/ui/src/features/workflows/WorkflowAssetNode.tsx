/** An asset step: a workspace file as an input. The output type follows the file. */

import type { StoredFileRow } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Download, File, FileInput, Input, Maximize2, Popover, Search, SlidingTabs, Upload } from "@openbot/ui";
import { createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { useBoard, type WfnBoard } from "./workflow-board";
import { asString, download, NodeShell, NodeToolbar, ToolAction, useField, useLocked } from "./workflow-node-parts";

/* --------------------------------------------------------------- Asset */

type AssetFilter = "recent" | "images" | "files";

const ASSET_FILTERS: readonly { value: AssetFilter; label: AppTextKey }[] = [
  { value: "recent", label: "workflow.asset.filter.recent" },
  { value: "images", label: "workflow.asset.filter.images" },
  { value: "files", label: "workflow.asset.filter.files" },
];

/** The files of the library: the files from the computer of this board, newest first, then the workspace files. */
const libraryFiles = (board: WfnBoard) => [...board.uploads(), ...board.catalogs().files];

/** The files of a drag from the computer, or none when the drag holds no files. */
const draggedFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes("Files") ? [...event.dataTransfer.files] : [];

function assetsFor(board: WfnBoard, filter: AssetFilter): readonly StoredFileRow[] {
  const available = libraryFiles(board).filter((file) => file.status === "available");
  if (filter === "images") return available.filter((file) => file.previewKind === "image");
  if (filter === "files") return available.filter((file) => file.previewKind !== "image");
  return available.slice(0, 9);
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toUpperCase() ?? "";
}

function AssetThumb(props: { file: StoredFileRow }) {
  return (
    <Show
      when={props.file.previewUrl}
      fallback={
        <span class="wfn-asset-glyph" aria-hidden="true">
          <File />
          <span>{fileExtension(props.file.name)}</span>
        </span>
      }
    >
      {(url) => <img class="wfn-media" src={url()} alt="" />}
    </Show>
  );
}

/** The files of one library tab whose names hold the query. Recent narrows nothing once the user searches. */
function assetsMatching(board: WfnBoard, filter: AssetFilter, query: string): readonly StoredFileRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return assetsFor(board, filter);
  const pool =
    filter === "recent" ? libraryFiles(board).filter((file) => file.status === "available") : assetsFor(board, filter);
  return pool.filter((file) => file.name.toLowerCase().includes(needle));
}

/**
 * One library tab: a grid that scrolls under the shared top and bottom fades. A thin thumb in the
 * popover padding replaces the native bar; it shows on hover or focus, drags, and pages on a track
 * press. The wheel, the trackpad and the keyboard still scroll the grid itself.
 */
function LibraryGrid(props: {
  files: readonly StoredFileRow[];
  query: string;
  selected: string | undefined;
  onPick: (file: StoredFileRow) => void;
}) {
  const { t } = useText();
  const fades = createScrollFades();
  const [thumb, setThumb] = createStore({ size: 0, offset: 0, dragging: false });
  let scroller: HTMLDivElement | undefined;
  const measure = () => {
    fades.measure();
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const room = scrollHeight - clientHeight;
    const size = room > 1 ? Math.max(24, (clientHeight * clientHeight) / scrollHeight) : 0;
    setThumb((draft) => {
      draft.size = size;
      draft.offset = room > 0 ? (scrollTop / room) * (clientHeight - size) : 0;
    });
  };
  const observer = new ResizeObserver(measure);
  onCleanup(() => observer.disconnect());
  // Pixels of scroll for one pixel of thumb travel.
  const ratio = () =>
    scroller ? (scroller.scrollHeight - scroller.clientHeight) / (scroller.clientHeight - thumb.size) : 0;
  const drag = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0 || !scroller) return;
    event.preventDefault();
    event.stopPropagation();
    const from = event.clientY;
    const top = scroller.scrollTop;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setThumb((draft) => {
      draft.dragging = true;
    });
    const move = (next: PointerEvent) => {
      if (scroller) scroller.scrollTop = top + (next.clientY - from) * ratio();
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setThumb((draft) => {
        draft.dragging = false;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const page = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0 || !scroller) return;
    const at = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const step = scroller.clientHeight * 0.9;
    scroller.scrollBy({ top: at < thumb.offset ? -step : step, behavior: "smooth" });
  };
  return (
    <div class="wfn-scroll">
      <div
        ref={(element) => {
          scroller = element;
          fades.adopt(element);
          observer.observe(element);
        }}
        class={["wfn-library-scroll", fades.classes()]}
        onScroll={measure}
      >
        <Show
          when={props.files.length > 0}
          fallback={<p class="wfn-library-empty">{t("workflow.asset.noMatches", { query: props.query.trim() })}</p>}
        >
          <div class="wfn-library-grid" ref={(element) => observer.observe(element)}>
            <For each={props.files}>
              {(file) => (
                <Button
                  variant="ghost"
                  class="wfn-library-tile"
                  aria-pressed={file.id === props.selected ? "true" : "false"}
                  onClick={() => props.onPick(file)}
                >
                  <span class="wfn-library-thumb">
                    <AssetThumb file={file} />
                  </span>
                  <span class="wfn-library-name">{file.name}</span>
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={thumb.size > 0}>
        <div
          class="wfn-scroll-track"
          data-dragging={thumb.dragging ? "" : undefined}
          aria-hidden="true"
          onPointerDown={page}
        >
          <div
            class="wfn-scroll-thumb"
            style={{ height: `${thumb.size}px`, translate: `-50% ${thumb.offset}px` }}
            onPointerDown={drag}
          />
        </div>
      </Show>
    </div>
  );
}

/** Opens the file dialog of the computer. The file goes into the workspace library. */
function UploadButton(props: { onAdd: (file: StoredFileRow) => void }) {
  const board = useBoard();
  const { t } = useText();
  let input: HTMLInputElement | undefined;
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => input?.click()}>
        <Upload aria-hidden="true" />
        {t("workflow.asset.upload")}
      </Button>
      <Input
        ref={(element) => {
          input = element;
        }}
        class="sr-only"
        type="file"
        tabindex={-1}
        aria-label={t("workflow.asset.upload")}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (chosen) props.onAdd(board.upload(chosen));
        }}
      />
    </>
  );
}

/** The workspace library, as the Higgsfield Assets panel: filter pills and a grid of files. */
function AssetLibrary(props: { selected?: string | undefined; onPick: (file: StoredFileRow) => void }) {
  const board = useBoard();
  const { t } = useText();
  const [filter, setFilter] = createSignal<AssetFilter>("recent");
  const [query, setQuery] = createSignal("");
  return (
    <>
      <div class="wfn-library-search">
        <Search aria-hidden="true" />
        <Input
          ref={(element: HTMLInputElement) => requestAnimationFrame(() => element.focus({ preventScroll: true }))}
          aria-label={t("workflow.asset.search")}
          placeholder={t("workflow.asset.search")}
          spellcheck={false}
          value={query()}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            const first = assetsMatching(board, filter(), query())[0];
            if (event.key === "Enter" && first) props.onPick(first);
          }}
        />
      </div>
      <SlidingTabs.Root
        class="wfn-library"
        value={filter()}
        onChange={(value) => {
          const next = ASSET_FILTERS.find((option) => option.value === value);
          if (next) setFilter(next.value);
        }}
      >
        <SlidingTabs.List class="wfn-library-tabs" aria-label={t("workflow.asset.files")}>
          <For each={ASSET_FILTERS}>
            {(option) => <SlidingTabs.Trigger value={option.value}>{t(option.label)}</SlidingTabs.Trigger>}
          </For>
        </SlidingTabs.List>
        <SlidingTabs.ContentSlot>
          <For each={ASSET_FILTERS}>
            {(option) => (
              <SlidingTabs.Content value={option.value}>
                <LibraryGrid
                  files={assetsMatching(board, option.value, query())}
                  query={query()}
                  selected={props.selected}
                  onPick={props.onPick}
                />
              </SlidingTabs.Content>
            )}
          </For>
        </SlidingTabs.ContentSlot>
      </SlidingTabs.Root>
    </>
  );
}

/** A workspace file as an input. The card opens the library; the output type follows the file. */
export function AssetNode(props: { id: string; file?: string }) {
  const board = useBoard();
  const { t, format } = useText();
  const [fileName] = useField(
    () => props.id,
    "file",
    untrack(() => props.file ?? ""),
    asString,
  );
  const [fileId] = useField(() => props.id, "fileId", "", asString);
  /** The file by its id, so two files with one name stay apart. A graph saved before the id finds it by name. */
  const file = () => {
    const files = libraryFiles(board);
    const id = fileId();
    return (
      (id ? files.find((candidate) => candidate.id === id) : undefined) ??
      files.find((candidate) => candidate.name === fileName())
    );
  };
  const setFile = (next: StoredFileRow) => board.setFields(props.id, { file: next.name, fileId: next.id });
  /** Files from the computer stay on this computer, so a host that cannot read them does not offer them. */
  const uploads = () => board.features()?.uploads !== false;
  const [open, setOpen] = createSignal(false);
  const [locked, setLocked] = useLocked(() => props.id);
  const [viewer, setViewer] = createSignal<ImageLightboxOpening>();
  const [dropping, setDropping] = createSignal(false);
  const isImage = () => file()?.previewKind === "image";
  /** A file from the computer, dropped on the card, goes into the library and becomes the asset. */
  const onDrop = (event: DragEvent) => {
    setDropping(false);
    const [dropped] = draggedFiles(event);
    if (!dropped || locked() || !uploads()) return;
    event.preventDefault();
    setFile(board.upload(dropped));
    setOpen(false);
  };
  return (
    <>
      <NodeShell
        id={props.id}
        label={t("workflow.asset.title")}
        kind="asset"
        media={isImage()}
        style={{ "--wfn-aspect": "4 / 3" }}
        output={file() ? (isImage() ? "image" : "file") : undefined}
        toolbar={
          <NodeToolbar id={props.id} name={t("workflow.asset.name")} locked={locked()} onLock={setLocked}>
            <Show when={!locked()}>
              <ToolAction
                text={t("workflow.asset.replace")}
                label={t("workflow.asset.replaceLabel")}
                icon={<FileInput />}
                onClick={() => setOpen(true)}
              />
            </Show>
            <Show when={isImage()}>
              <ToolAction
                text={t("workflow.node.toolbar.view")}
                label={t("workflow.node.toolbar.viewLabel")}
                icon={<Maximize2 />}
                onClick={() => {
                  const current = file();
                  if (current) setViewer({ images: [current], index: 0 });
                }}
              />
            </Show>
            <Show when={file()}>
              {(current) => (
                <Show when={current().previewUrl}>
                  {(url) => (
                    <ToolAction
                      text={t("workflow.node.toolbar.download")}
                      label={t("workflow.asset.download")}
                      icon={<Download />}
                      onClick={() => download(url(), current().name)}
                    />
                  )}
                </Show>
              )}
            </Show>
          </NodeToolbar>
        }
      >
        <Popover.Root open={open()} onOpenChange={setOpen} placement="right-start" gutter={56}>
          <Popover.Trigger
            class="wfn-asset-trigger"
            disabled={locked()}
            data-dropping={dropping() ? "" : undefined}
            onDragOver={(event: DragEvent) => {
              if (locked() || !uploads() || !event.dataTransfer?.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={onDrop}
            aria-label={file() ? t("workflow.asset.current", { name: file()?.name ?? "" }) : t("workflow.asset.choose")}
          >
            <Show
              when={file()}
              fallback={
                <span class="wfn-asset-empty">
                  <span class="wfn-asset-icon" aria-hidden="true">
                    <File />
                  </span>
                  {t("workflow.asset.choose")}
                </span>
              }
            >
              {(current) => (
                <Show
                  when={isImage()}
                  fallback={
                    <span class="wfn-asset-file">
                      <AssetThumb file={current()} />
                      <span class="wfn-asset-text">
                        <span class="wfn-asset-name">{current().name}</span>
                        <span class="wfn-asset-meta">{format.fileSize(current().size)}</span>
                      </span>
                    </span>
                  }
                >
                  <AssetThumb file={current()} />
                  <span class="wfn-chip wfn-asset-caption">{current().name}</span>
                </Show>
              )}
            </Show>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="ui-popover-menu-surface wfn-popover" data-wfn-portal="">
              <div class="wfn-popover-head">
                <Popover.Title class="wfn-popover-title">{t("workflow.asset.library")}</Popover.Title>
                <Show when={uploads()}>
                  <UploadButton
                    onAdd={(next) => {
                      setFile(next);
                      setOpen(false);
                    }}
                  />
                </Show>
              </div>
              <AssetLibrary
                selected={file()?.id}
                onPick={(next) => {
                  setFile(next);
                  setOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </NodeShell>
      <Show when={viewer()}>
        {(opening) => (
          <ImageLightbox
            opening={opening()}
            onDownload={(attachment) => {
              if (attachment.previewUrl) download(attachment.previewUrl, attachment.name);
            }}
            onClose={() => setViewer(undefined)}
          />
        )}
      </Show>
    </>
  );
}
