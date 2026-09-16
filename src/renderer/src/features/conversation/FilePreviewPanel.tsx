import type { FilePreview } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { PanelResizer, readPanelWidth, savePanelWidth } from "../../components/PanelResizer";
import { Button, ExternalLink, File, X } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { MarkdownFilePreview } from "./MarkdownFilePreview";

const PANEL_STORAGE_KEY = "openbot:browser-panel-width";
const PANEL_MIN = 220;
const PANEL_MAX = 1600;
const TEXT_LIMIT = 1_000_000;
/** Kinds the panel hands to the browser as an object URL instead of decoding itself. */
const BLOB_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

interface FilePreviewPanelProps {
  preview: FilePreview;
  agents: AgentProfile[];
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenLink: (url: string) => void;
  onOpenSharedFile: (path: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
  onOpenExternally: () => void;
  onClose: () => void;
}

export default function FilePreviewPanel(props: FilePreviewPanelProps) {
  const defaultPanelWidth = () => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, props.defaultWidth())));
  const [panelWidth, setPanelWidth] = createSignal(
    readPanelWidth(PANEL_STORAGE_KEY, defaultPanelWidth(), PANEL_MIN, PANEL_MAX),
  );
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  // The panel mounts when a file opens, so it has to paint its closed state
  // first. Two frames guarantee that paint before the open state applies.
  const [revealed, setRevealed] = createSignal(false);
  let currentPreviewUrl: string | null = null;
  const text = createMemo(() => {
    if (!props.preview.bytes || (props.preview.previewKind !== "text" && props.preview.previewKind !== "markdown")) {
      return { value: "", truncated: false };
    }
    const value = new TextDecoder().decode(props.preview.bytes);
    return { value: value.slice(0, TEXT_LIMIT), truncated: value.length > TEXT_LIMIT };
  });

  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );
  createEffect(
    () => props.preview,
    (preview) => {
      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
      if (!preview.bytes || !BLOB_PREVIEW_KINDS.has(preview.previewKind)) {
        setPreviewUrl(null);
        return;
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(preview.bytes).buffer], { type: preview.mimeType }));
      currentPreviewUrl = url;
      setPreviewUrl(url);
    },
  );
  onCleanup(() => {
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  });

  const revealPanel = () => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setRevealed(true);
      });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  };

  const resizeDefaultPanel = () => {
    setPanelWidth(Math.round(Math.min(props.maxWidth(), Math.max(PANEL_MIN, defaultPanelWidth()))));
  };

  return (
    <aside
      ref={revealPanel}
      id="file-preview-panel"
      class="browser-panel file-preview-panel t-panel-slide"
      data-open={revealed() ? "true" : "false"}
      aria-label="File preview"
    >
      <PanelResizer
        class="right-panel-resizer"
        label="Resize file preview"
        controls="file-preview-panel"
        direction="right"
        value={panelWidth()}
        defaultValue={defaultPanelWidth()}
        min={PANEL_MIN}
        max={props.maxWidth}
        onResize={setPanelWidth}
        onResizeEnd={(width) => savePanelWidth(PANEL_STORAGE_KEY, width)}
        onParentResize={resizeDefaultPanel}
        onReset={() => {
          window.localStorage.removeItem(PANEL_STORAGE_KEY);
          setPanelWidth(defaultPanelWidth());
        }}
      />
      <header class="file-preview-header">
        <File class="file-preview-file-icon" />
        <h2 title={props.preview.name}>{props.preview.name}</h2>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label="Open file externally"
          onClick={props.onOpenExternally}
        >
          <ExternalLink class="browser-toolbar-icon" />
        </Button>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label="Close file preview"
          onClick={props.onClose}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class="file-preview-content">
        <Show when={props.preview.previewKind === "markdown"}>
          <MarkdownFilePreview
            class="file-preview-markdown"
            renderedClass="message-markdown"
            sourceClass="file-preview-markdown-source"
            statusClass="file-preview-markdown-status"
            truncatedClass="file-preview-truncated"
            resetKey={props.preview.name}
            body={text().value}
            truncated={text().truncated}
            agents={props.agents}
            onSelectAgent={() => undefined}
            onOpenLink={props.onOpenLink}
            onOpenSharedFile={props.onOpenSharedFile}
            onOpenWorkspaceFile={props.onOpenWorkspaceFile}
          />
        </Show>
        <Show when={props.preview.previewKind === "text"}>
          <pre class="file-preview-text">{text().value}</pre>
        </Show>
        <Show when={props.preview.previewKind === "image" && previewUrl()}>
          <div class="file-preview-image-wrap">
            <img class="file-preview-image" src={previewUrl() ?? ""} alt={props.preview.name} />
          </div>
        </Show>
        <Show when={props.preview.previewKind === "pdf" && previewUrl()}>
          <iframe class="file-preview-pdf" title={props.preview.name} src={previewUrl() ?? ""} />
        </Show>
        <Show when={props.preview.previewKind === "audio" && previewUrl()}>
          <audio class="file-preview-audio" controls src={previewUrl() ?? ""}>
            {/* A file on the user's computer carries no caption track. The empty element declares
                that, which browsers ignore, and keeps the media-caption rule satisfied. */}
            <track kind="captions" />
          </audio>
        </Show>
        <Show when={props.preview.previewKind === "video" && previewUrl()}>
          <video class="file-preview-video" controls src={previewUrl() ?? ""}>
            <track kind="captions" />
          </video>
        </Show>
        <Show when={props.preview.previewKind === "none"}>
          <div class="file-preview-unsupported">
            <File />
            <strong>Preview unavailable</strong>
            <span>This file type can be opened in its default application.</span>
            <Button variant="outline" type="button" onClick={props.onOpenExternally}>
              Open externally
            </Button>
          </div>
        </Show>
      </div>
    </aside>
  );
}
