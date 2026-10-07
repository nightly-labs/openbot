import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, canPreviewAttachment } from "@openbot/contracts/ipc";
import { AudioLines, Button, Download, Film } from "@openbot/ui";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { AnchoredTooltip } from "./AnchoredTooltip";
import { attachmentReferenceTone } from "./AttachmentReference";
import { MediaFilePreview } from "./MediaFilePreview";

export function AttachmentDownloadAll(props: { count: number; pending: boolean; onDownload: () => void }) {
  const { t } = useText();
  return (
    <div class="attachment-download-bar">
      <span>{t("attachment.downloadAll.count", { count: props.count })}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={props.pending ? t("attachment.downloadAll.pending") : t("attachment.downloadAll.label")}
        loading={props.pending}
        loadingLabel={t("attachment.downloadAll.zipping")}
        onClick={() => props.onDownload()}
      >
        <Download />
        {t("attachment.downloadAll.action")}
      </Button>
    </div>
  );
}

export function AttachmentCards(props: {
  attachments: AttachmentSummary[];
  /** `origin` is the clicked card, for a viewer that zooms out of it. */
  onPreview: (attachment: AttachmentSummary, origin: HTMLElement) => void;
  onAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
}) {
  const { t, format } = useText();
  const tooltipId = `attachment-action-tooltip-${createUniqueId()}`;
  const [tooltip, setTooltip] = createSignal<{ anchor: HTMLElement; content: string } | null>(null);
  // An image whose preview does not load was deleted from the host, or never arrived. The card
  // keeps its place in the message and says so, instead of an empty frame.
  const [missing, setMissing] = createSignal<ReadonlySet<string>>(new Set());
  const mediaKind = (attachment: AttachmentSummary) =>
    playableMediaKind(attachment.mimeType || attachmentMimeTypeForName(attachment.name));
  const isMissing = (attachment: AttachmentSummary) => missing().has(attachment.id);
  const markMissing = (attachment: AttachmentSummary) => setMissing((current) => new Set(current).add(attachment.id));

  const openTooltip = (anchor: HTMLElement) => {
    setTooltip({ anchor, content: t("attachment.openFile") });
  };
  const closeTooltip = (anchor: HTMLElement) => {
    if (tooltip()?.anchor === anchor) setTooltip(null);
  };
  const closeTooltipOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && event.currentTarget instanceof HTMLElement) closeTooltip(event.currentTarget);
  };

  return (
    <>
      <div class="message-attachments">
        <For each={props.attachments}>
          {(attachment) => (
            <div
              class="message-attachment"
              data-media={mediaKind(attachment) ?? undefined}
              data-status={isMissing(attachment) ? "missing" : undefined}
            >
              <Button
                variant="ghost"
                type="button"
                class="attachment-preview-button"
                disabled={isMissing(attachment) || !canPreviewAttachment(attachment)}
                aria-label={t("attachment.preview", { name: attachment.name })}
                data-attachment-id={attachment.id}
                data-cuelume-tap="open"
                onClick={(event) => props.onPreview(attachment, event.currentTarget)}
              >
                <Show
                  when={attachment.previewKind === "image" && attachment.previewUrl && !isMissing(attachment)}
                  fallback={
                    <span
                      class="attachment-file-visual"
                      data-file-tone={attachmentReferenceTone(attachment.name)}
                      aria-hidden="true"
                    >
                      <Show when={mediaKind(attachment)} fallback={<AttachmentFileIcon />}>
                        <Show when={mediaKind(attachment) === "audio"} fallback={<Film />}>
                          <AudioLines />
                        </Show>
                      </Show>
                    </span>
                  }
                >
                  <span
                    class="attachment-file-visual attachment-file-image"
                    data-file-tone={attachmentReferenceTone(attachment.name)}
                  >
                    <img
                      src={attachment.previewUrl ?? ""}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => markMissing(attachment)}
                    />
                  </span>
                </Show>
                <span class="attachment-file-copy">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <small>{isMissing(attachment) ? t("attachment.notFound") : format.fileSize(attachment.size)}</small>
                </span>
              </Button>
              <Show when={!isMissing(attachment)}>
                <Button
                  variant="ghost"
                  type="button"
                  class="attachment-open-button"
                  aria-label={t("attachment.download", { name: attachment.name })}
                  onClick={() => {
                    setTooltip(null);
                    props.onAction(attachment, "download");
                  }}
                >
                  <Download />
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  class="attachment-open-button"
                  aria-label={t("attachment.open", { name: attachment.name })}
                  aria-describedby={tooltipId}
                  onPointerEnter={(event) => openTooltip(event.currentTarget)}
                  onMouseEnter={(event) => openTooltip(event.currentTarget)}
                  onPointerLeave={(event) => closeTooltip(event.currentTarget)}
                  onMouseLeave={(event) => closeTooltip(event.currentTarget)}
                  onFocus={(event) => openTooltip(event.currentTarget)}
                  onBlur={(event) => closeTooltip(event.currentTarget)}
                  onKeyDown={closeTooltipOnEscape}
                  onClick={() => {
                    setTooltip(null);
                    props.onAction(attachment, "open");
                  }}
                >
                  <AttachmentOpenIcon />
                </Button>
              </Show>
              <Show when={attachment.previewUrl && !isMissing(attachment)}>
                <MediaFilePreview
                  kind={mediaKind(attachment)}
                  src={attachment.previewUrl ?? ""}
                  name={attachment.name}
                  class="attachment-media-player"
                  preload="none"
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={tooltip()}>
        {(current) => <AnchoredTooltip id={tooltipId} anchor={current().anchor} content={current().content} />}
      </Show>
    </>
  );
}

export function fileBadge(attachment: AttachmentSummary): string {
  if (attachment.previewKind === "pdf") return "PDF";
  if (attachment.previewKind === "text") return "TXT";
  return attachment.name.split(".").at(-1)?.slice(0, 4).toUpperCase() || "FILE";
}

function AttachmentFileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5.5 2.75h5.75l3.25 3.5v11H5.5z" />
      <path d="M11.25 2.75v3.5h3.25M7.75 10h4.5M7.75 13h4.5" />
    </svg>
  );
}

function AttachmentOpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M8.25 5.25H5.5v9.25h9.25v-2.75" />
      <path d="M10.25 5.25h4.5v4.5M14.5 5.5l-6 6" />
    </svg>
  );
}
