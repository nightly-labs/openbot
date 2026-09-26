import type { FilePreview } from "@openbot/contracts/ipc";
import { Button, Download, ExternalLink, File, FolderOpen, X } from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import type { AgentProfile } from "@openbot/ui/data";
import { MarkdownFilePreview } from "@openbot/ui/features/conversation/MarkdownFilePreview";
import { SpreadsheetFilePreview } from "@openbot/ui/features/conversation/SpreadsheetFilePreview";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";

const PANEL_MIN = 220;
const PANEL_MAX = 1600;
const TEXT_LIMIT = 1_000_000;
/** Kinds the panel hands to the browser as an object URL instead of decoding itself. */
const BLOB_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

interface FilePreviewPanelProps {
  readWidth: (fallback: number, min: number, max: number) => number;
  onResizeEnd: (width: number) => void;
  onResetWidth: () => void;
  preview: FilePreview;
  agents: AgentProfile[];
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenLink: (url: string) => void;
  onOpenSharedFile: (path: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
  /** Set when the file already has a URL the panel can point at, as an attachment does. */
  sourceUrl?: string | null;
  onOpenExternally: () => void;
  allowExternalOpen?: boolean;
  /** Present for an attachment, which the user can also save or locate. A file already has a path. */
  onDownload?: () => void;
  onReveal?: () => void;
  onClose: () => void;
}

export default function FilePreviewPanel(props: FilePreviewPanelProps) {
  const { t, format } = useText();
  const defaultPanelWidth = () => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, props.defaultWidth())));
  const [panelWidth, setPanelWidth] = createSignal(props.readWidth(defaultPanelWidth(), PANEL_MIN, PANEL_MAX));
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
    () => ({ preview: props.preview, sourceUrl: props.sourceUrl }),
    ({ preview, sourceUrl }) => {
      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
      if (sourceUrl && BLOB_PREVIEW_KINDS.has(preview.previewKind)) {
        setPreviewUrl(sourceUrl);
        return;
      }
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
      aria-label={t("preview.panel.label")}
    >
      <PanelResizer
        class="right-panel-resizer"
        label={t("preview.panel.resize")}
        controls="file-preview-panel"
        direction="right"
        value={panelWidth()}
        defaultValue={defaultPanelWidth()}
        min={PANEL_MIN}
        max={props.maxWidth}
        onResize={setPanelWidth}
        onResizeEnd={props.onResizeEnd}
        onParentResize={resizeDefaultPanel}
        onReset={() => {
          props.onResetWidth();
          setPanelWidth(defaultPanelWidth());
        }}
      />
      <header class="file-preview-header">
        <File class="file-preview-file-icon" />
        <h2 title={props.preview.name}>{props.preview.name}</h2>
        <Show when={props.allowExternalOpen !== false}>
          <Button
            variant="ghost"
            type="button"
            class="browser-toolbar-button"
            aria-label={t("preview.panel.openExternally")}
            onClick={props.onOpenExternally}
          >
            <ExternalLink class="browser-toolbar-icon" />
          </Button>
        </Show>
        <Show when={props.onDownload}>
          {(download) => (
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label={t("preview.panel.download")}
              onClick={() => download()()}
            >
              <Download class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Show when={props.onReveal}>
          {(reveal) => (
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label={t("preview.panel.reveal")}
              onClick={() => reveal()()}
            >
              <FolderOpen class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label={t("preview.panel.close")}
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
            statusClass="file-preview-markdown-status"
            truncatedClass="file-preview-truncated"
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
          <Show when={text().truncated}>
            <p class="file-preview-truncated">{t("preview.truncated", { limit: format.number(TEXT_LIMIT) })}</p>
          </Show>
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
        <Show when={props.preview.previewKind === "spreadsheet"}>
          <SpreadsheetFilePreview class="file-preview-spreadsheet" bytes={props.preview.bytes} />
        </Show>
        <Show when={props.preview.previewKind === "none"}>
          <div class="file-preview-unsupported">
            <File />
            <strong>{t("preview.unsupported.title")}</strong>
            <Show when={props.allowExternalOpen !== false}>
              <span>{t("preview.unsupported.description")}</span>
              <Button variant="outline" type="button" onClick={props.onOpenExternally}>
                {t("preview.unsupported.openExternally")}
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}
