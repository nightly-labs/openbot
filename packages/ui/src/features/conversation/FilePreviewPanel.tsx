import type { FilePreview, WorkspaceDirectory, WorkspaceDirectoryEntry } from "@openbot/contracts/ipc";
import { ArrowLeft, Button, Code, Download, ExternalLink, File, Folder, FolderOpen, WrapText, X } from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import type { AgentProfile } from "@openbot/ui/data";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { MarkdownFilePreview } from "@openbot/ui/features/conversation/MarkdownFilePreview";
import { SpreadsheetFilePreview } from "@openbot/ui/features/conversation/SpreadsheetFilePreview";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { MediaFilePreview } from "./MediaFilePreview";

const PANEL_MIN = 220;
const PANEL_MAX = 1600;
const TEXT_LIMIT = 1_000_000;
/** Kinds the panel hands to the browser as an object URL instead of decoding itself. */
const BLOB_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

interface FilePreviewPanelProps {
  readWidth: (fallback: number, min: number, max: number) => number;
  onResizeEnd: (width: number) => void;
  onResetWidth: () => void;
  readWrapLines: () => boolean;
  onWrapLinesChange: (wrap: boolean) => void;
  /** Empty while the panel shows a folder. */
  preview: FilePreview | null;
  /** A workspace folder. The panel lists it instead of a file. */
  directory?: WorkspaceDirectory | null;
  agents: AgentProfile[];
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenLink: (url: string) => void;
  onOpenSharedFile: (path: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
  onOpenWorkspaceFolder?: (path: string) => void;
  /** Goes to the folder the file came from, or to the parent of the folder. */
  onBack?: (() => void) | undefined;
  /** Set when the file already has a URL the panel can point at, as an attachment does. */
  sourceUrl?: string | null;
  /**
   * Set for an HTML file that the app can serve as a sandboxed page with its scripts. The panel
   * shows the page, and the source on request. Without it the panel shows the source.
   */
  pageUrl?: string | null | undefined;
  onOpenExternally: () => void;
  allowExternalOpen?: boolean;
  onDownload?: () => void;
  onReveal?: (() => void) | undefined;
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
  const [rawSource, setRawSource] = createSignal(false);
  const [wrapLines, setWrapLines] = createSignal(props.readWrapLines());
  let currentPreviewUrl: string | null = null;
  const file = () => (props.directory ? null : props.preview);
  const previewKind = () => file()?.previewKind;
  const pageUrl = () => (previewKind() === "text" ? props.pageUrl : null) ?? null;
  const showsSourceText = () =>
    (previewKind() === "text" && (rawSource() || !pageUrl())) || (previewKind() === "markdown" && rawSource());
  const title = () => props.directory?.name ?? props.preview?.name ?? "";
  const text = createMemo(() => {
    const preview = file();
    if (!preview?.bytes || (preview.previewKind !== "text" && preview.previewKind !== "markdown")) {
      return { value: "", truncated: false };
    }
    const value = new TextDecoder().decode(preview.bytes);
    return { value: value.slice(0, TEXT_LIMIT), truncated: value.length > TEXT_LIMIT };
  });
  const openEntry = (entry: WorkspaceDirectoryEntry) => {
    if (entry.kind === "directory") props.onOpenWorkspaceFolder?.(entry.path);
    else props.onOpenWorkspaceFile(entry.path);
  };

  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );
  createEffect(file, () => {
    setRawSource(false);
  });
  createEffect(
    () => ({ preview: file(), sourceUrl: props.sourceUrl }),
    ({ preview, sourceUrl }) => {
      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
      if (!preview) {
        setPreviewUrl(null);
        return;
      }
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

  const toggleWrapLines = () => {
    const wrap = !wrapLines();
    setWrapLines(wrap);
    props.onWrapLinesChange(wrap);
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
        <Show when={props.onBack}>
          {(back) => (
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label={t("preview.panel.back")}
              onClick={() => back()()}
            >
              <ArrowLeft class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Show when={props.directory} fallback={<File class="file-preview-file-icon" />}>
          <Folder class="file-preview-file-icon" />
        </Show>
        <h2 title={props.directory?.path ?? title()}>{title()}</h2>
        <Show when={previewKind() === "markdown"}>
          <Button
            variant="ghost"
            type="button"
            class="browser-toolbar-button"
            aria-label={t("preview.panel.rawMarkdown")}
            aria-pressed={rawSource() ? "true" : "false"}
            onClick={() => setRawSource((raw) => !raw)}
          >
            <Code class="browser-toolbar-icon" />
          </Button>
        </Show>
        <Show when={pageUrl()}>
          <Button
            variant="ghost"
            type="button"
            class="browser-toolbar-button"
            aria-label={t("preview.panel.rawHtml")}
            aria-pressed={rawSource() ? "true" : "false"}
            onClick={() => setRawSource((raw) => !raw)}
          >
            <Code class="browser-toolbar-icon" />
          </Button>
        </Show>
        <Show when={showsSourceText()}>
          <Button
            variant="ghost"
            type="button"
            class="browser-toolbar-button"
            aria-label={t("preview.panel.wrapLines")}
            aria-pressed={wrapLines() ? "true" : "false"}
            onClick={toggleWrapLines}
          >
            <WrapText class="browser-toolbar-icon" />
          </Button>
        </Show>
        <Show when={file() && props.allowExternalOpen !== false}>
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
        <Show when={file() && props.onDownload}>
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
        <Show when={file() && props.onReveal}>
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
          data-cuelume-tap="close"
          onClick={props.onClose}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class="file-preview-content">
        <Show when={props.directory}>
          {(directory) => (
            <Show
              when={directory().entries.length > 0}
              fallback={<p class="file-preview-folder-empty">{t("preview.folder.empty")}</p>}
            >
              <ul class="file-preview-folder" aria-label={directory().name}>
                <For each={directory().entries}>
                  {(entry) => (
                    <li>
                      <Button
                        variant="ghost"
                        type="button"
                        class="file-preview-folder-entry"
                        title={entry.path}
                        onClick={() => openEntry(entry)}
                      >
                        <Show when={entry.kind === "directory"} fallback={<File class="file-preview-file-icon" />}>
                          <Folder class="file-preview-file-icon" />
                        </Show>
                        <span class="file-preview-folder-name">{entry.name}</span>
                        <span class="file-preview-folder-meta">
                          {entry.kind === "file" ? format.fileSize(entry.size) : ""}
                        </span>
                        <span class="file-preview-folder-meta">
                          {entry.modifiedAt > 0 ? format.date(entry.modifiedAt, { dateStyle: "medium" }) : ""}
                        </span>
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={directory().truncated}>
                <p class="file-preview-truncated">
                  {t("preview.folder.truncated", { limit: format.number(directory().entries.length) })}
                </p>
              </Show>
            </Show>
          )}
        </Show>
        <Show when={previewKind() === "markdown" && rawSource()}>
          <pre class={{ "file-preview-text": true, "file-preview-text-wrap": wrapLines() }}>{text().value}</pre>
        </Show>
        <Show when={previewKind() === "markdown" && !rawSource()}>
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
        <Show when={!rawSource() && pageUrl()}>
          {(url) => <ChatVisual fill src={url()} title={title()} onOpenLink={props.onOpenLink} />}
        </Show>
        <Show when={previewKind() === "text" && (rawSource() || !pageUrl())}>
          <pre class={{ "file-preview-text": true, "file-preview-text-wrap": wrapLines() }}>{text().value}</pre>
          <Show when={text().truncated}>
            <p class="file-preview-truncated">{t("preview.truncated", { limit: format.number(TEXT_LIMIT) })}</p>
          </Show>
        </Show>
        <Show when={previewKind() === "image" && previewUrl()}>
          <div class="file-preview-image-wrap">
            <img class="file-preview-image" src={previewUrl() ?? ""} alt={title()} />
          </div>
        </Show>
        <Show when={previewKind() === "pdf" && previewUrl()}>
          <iframe class="file-preview-pdf" title={title()} src={previewUrl() ?? ""} />
        </Show>
        <Show when={previewUrl()}>
          <MediaFilePreview
            kind={previewKind() === "audio" ? "audio" : previewKind() === "video" ? "video" : null}
            src={previewUrl() ?? ""}
            name={title()}
            class={previewKind() === "audio" ? "file-preview-audio" : "file-preview-video"}
          />
        </Show>
        <Show when={previewKind() === "spreadsheet"}>
          <SpreadsheetFilePreview class="file-preview-spreadsheet" bytes={file()?.bytes ?? null} />
        </Show>
        <Show when={previewKind() === "none"}>
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
