import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type StoredFileRow, WORKFLOW_ASSET_VIDEO_TYPES, WORKFLOW_PICTURE_TYPES } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Download, File, FileInput, Input, Maximize2, Popover, Search, SlidingTabs, Upload } from "@openbot/ui";
import { createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { usePictureShape } from "./picture-shape";
import { useBoard, type WfnBoard } from "./workflow-board";
import {
  asString,
  downloadMedia,
  NodeShell,
  NodeToolbar,
  ToolAction,
  useField,
  useLocked,
} from "./workflow-node-parts";
import { CardPicture, CardPictureLoading, VideoFrame } from "./workflow-picture";

type AssetFilter = "recent" | "images" | "files";

const ASSET_FILTERS: readonly { value: AssetFilter; label: AppTextKey }[] = [
  { value: "recent", label: "workflow.asset.filter.recent" },
  { value: "images", label: "workflow.asset.filter.images" },
  { value: "files", label: "workflow.asset.filter.files" },
];

const libraryFiles = (board: WfnBoard) => [...board.uploads(), ...board.catalogs().files];

const draggedFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes("Files") ? [...event.dataTransfer.files] : [];

function hostFile(board: WfnBoard, id: string, name: string): StoredFileRow | undefined {
  const media = board.catalogs().media;
  const videoType = attachmentMimeTypeForName(name);
  const video = WORKFLOW_ASSET_VIDEO_TYPES.has(videoType);
  const url = video ? null : media?.(id, "image");
  if (!media || (!video && !url)) return undefined;
  return {
    id,
    name,
    size: 0,
    kind: video ? "file" : "image",
    mimeType: video ? videoType : "image/png",
    previewKind: video ? "none" : "image",
    previewUrl: url ?? null,
    source: "generated",
    agentId: null,
    conversation: null,
    messageId: null,
    createdAt: "",
    status: "available",
    deletable: false,
  };
}

function assetsFor(board: WfnBoard, filter: AssetFilter): readonly StoredFileRow[] {
  const available = libraryFiles(board).filter((file) => file.status === "available");
  if (filter === "images") return available.filter((file) => file.previewKind === "image");
  if (filter === "files") return available.filter((file) => file.previewKind !== "image");
  return available.slice(0, 9);
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toUpperCase() ?? "";
}

function thumbUrl(board: WfnBoard, file: StoredFileRow): string | null | undefined {
  const preview = board.catalogs().mediaPreview;
  if (!preview || file.previewKind !== "image" || board.uploads().includes(file)) return file.previewUrl;
  return preview(file.id);
}

function findFile(board: WfnBoard, fileId: string, name: string): StoredFileRow | undefined {
  const files = libraryFiles(board);
  return (
    (fileId ? files.find((candidate) => candidate.id === fileId) : undefined) ??
    (name ? files.find((candidate) => candidate.name === name) : undefined) ??
    (fileId ? hostFile(board, fileId, name) : undefined)
  );
}

function assetFile(board: WfnBoard, id: string): StoredFileRow | undefined {
  const fileId = board.field(id, "fileId");
  const name = board.field(id, "file");
  return findFile(board, typeof fileId === "string" ? fileId : "", typeof name === "string" ? name : "");
}

export function assetPicture(board: WfnBoard, id: string): string | undefined {
  const file = assetFile(board, id);
  return file?.previewKind === "image" ? (thumbUrl(board, file) ?? undefined) : undefined;
}

const LIBRARY_VIDEO_FRAME_BYTES = 32 * 1024 * 1024;

const isVideoFile = (file: StoredFileRow | undefined) => WORKFLOW_ASSET_VIDEO_TYPES.has(file?.mimeType ?? "");

function videoFrameUrl(board: WfnBoard, file: StoredFileRow, card: boolean): string | undefined {
  if (!isVideoFile(file) || (!card && file.size > LIBRARY_VIDEO_FRAME_BYTES)) return undefined;
  return board.catalogs().media?.(file.id, "video") ?? undefined;
}

function AssetGlyph(props: { name: string }) {
  return (
    <span class="wfn-asset-glyph" aria-hidden="true">
      <File />
      <span>{fileExtension(props.name)}</span>
    </span>
  );
}

function AssetThumb(props: { file: StoredFileRow; card?: boolean }) {
  const board = useBoard();
  return (
    <Show
      when={videoFrameUrl(board, props.file, props.card === true)}
      keyed
      fallback={
        <Show
          when={thumbUrl(board, props.file)}
          fallback={
            <Show
              when={props.card && thumbUrl(board, props.file) === undefined}
              fallback={<AssetGlyph name={props.file.name} />}
            >
              <CardPictureLoading />
            </Show>
          }
        >
          {(url) =>
            props.card ? (
              <CardPicture src={url()} alt="" />
            ) : (
              <img class="wfn-media" src={url()} alt="" decoding="async" draggable="false" />
            )
          }
        </Show>
      }
    >
      {(src) => <VideoFrame src={src} card={props.card} fallback={<AssetGlyph name={props.file.name} />} />}
    </Show>
  );
}

function assetsMatching(board: WfnBoard, filter: AssetFilter, query: string): readonly StoredFileRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return assetsFor(board, filter);
  const pool =
    filter === "recent" ? libraryFiles(board).filter((file) => file.status === "available") : assetsFor(board, filter);
  return pool.filter((file) => file.name.toLowerCase().includes(needle));
}

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

function UploadButton(props: { busy: boolean; onChoose: (file: File) => void }) {
  const board = useBoard();
  const { t } = useText();
  let input: HTMLInputElement | undefined;
  return (
    <>
      <Button variant="ghost" size="xs" disabled={props.busy} onClick={() => input?.click()}>
        <Upload aria-hidden="true" />
        {t("workflow.asset.upload")}
      </Button>
      <Input
        ref={(element) => {
          input = element;
        }}
        class="sr-only"
        type="file"
        accept={
          board.catalogs().upload ? [...(board.catalogs().uploadTypes ?? WORKFLOW_PICTURE_TYPES)].join(",") : undefined
        }
        tabindex={-1}
        aria-label={t("workflow.asset.upload")}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (chosen) props.onChoose(chosen);
        }}
      />
    </>
  );
}

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
  const file = () => findFile(board, fileId(), fileName());
  const setFile = (next: StoredFileRow) => board.setFields(props.id, { file: next.name, fileId: next.id });
  const uploads = () => board.features()?.uploads !== false;
  const [open, setOpen] = createSignal(false);
  const [locked, setLocked] = useLocked(() => props.id);
  const [viewer, setViewer] = createSignal<ImageLightboxOpening>();
  const [dropping, setDropping] = createSignal(false);
  const isImage = () => file()?.previewKind === "image";
  const isVideo = () => isVideoFile(file());
  const shape = usePictureShape(() => {
    const current = file();
    return current && isImage() ? (thumbUrl(board, current) ?? undefined) : undefined;
  });
  const clear = () => (isImage() ? shape()?.clear === true : false);
  const [sending, setSending] = createSignal(false);
  const send = (chosen: File) => {
    setSending(true);
    setOpen(false);
    board
      .upload(chosen)
      .then(setFile, () => undefined)
      .finally(() => setSending(false));
  };
  const onDrop = (event: DragEvent) => {
    setDropping(false);
    const files = draggedFiles(event);
    const [dropped] = files;
    if (!dropped || locked() || !uploads() || sending()) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length > 1 && board.dropFiles) board.dropFiles(props.id, files);
    else send(dropped);
  };
  return (
    <>
      <NodeShell
        id={props.id}
        label={t("workflow.asset.title")}
        kind="asset"
        media={isImage() || isVideo()}
        clear={clear()}
        style={{ "--wfn-aspect": clear() ? String(shape()?.ratio ?? 4 / 3) : "4 / 3" }}
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
                <Show when={board.catalogs().download || current().previewUrl}>
                  <ToolAction
                    text={t("workflow.node.toolbar.download")}
                    label={t("workflow.asset.download")}
                    icon={<Download />}
                    onClick={() => downloadMedia(board, current().id, current().previewUrl, current().name)}
                  />
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
            aria-busy={sending() ? "true" : undefined}
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
                  when={isImage() || isVideo()}
                  fallback={
                    <span class="wfn-asset-file">
                      <AssetThumb file={current()} />
                      <span class="wfn-asset-text">
                        <span class="wfn-asset-name">{current().name}</span>
                        <Show when={current().size > 0}>
                          <span class="wfn-asset-meta">{format.fileSize(current().size)}</span>
                        </Show>
                      </span>
                    </span>
                  }
                >
                  <AssetThumb file={current()} card />
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
                  <UploadButton busy={sending()} onChoose={send} />
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
              downloadMedia(board, attachment.id, attachment.previewUrl, attachment.name);
            }}
            onClose={() => setViewer(undefined)}
          />
        )}
      </Show>
    </>
  );
}
