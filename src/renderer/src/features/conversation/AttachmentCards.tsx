import { type AttachmentSummary, canPreviewAttachment } from "@openbot/contracts/ipc";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { Button, Download, Spinner } from "../../components/ui";
import { AnchoredTooltip } from "./AnchoredTooltip";
import { attachmentReferenceTone } from "./AttachmentReference";

/**
 * The whole-list action, shaped like the account update island: a tinted bar
 * that states what is attached, with a light action button beside it. The
 * bottom edge tucks under the first attachment card, so the stack reads as one
 * object rather than a button parked above a list.
 */
export function AttachmentDownloadAll(props: { count: number; pending: boolean; onDownload: () => void }) {
  const label = () => (props.pending ? "Downloading ZIP…" : "Download all as ZIP");
  return (
    <div class="attachment-download-island">
      <p class="attachment-download-island__copy">{props.count} attachments</p>
      <div class="attachment-download-island__action-shell">
        <Button
          type="button"
          size="xs"
          class="attachment-download-island__action"
          aria-label={label()}
          aria-busy={props.pending ? "true" : undefined}
          disabled={props.pending}
          onClick={() => props.onDownload()}
        >
          <span class="attachment-download-island__action-content">
            <span class="attachment-download-island__icon t-icon-swap" data-state={props.pending ? "b" : "a"}>
              <span class="t-icon" data-icon="a" aria-hidden="true">
                <Download />
              </span>
              <span class="t-icon" data-icon="b" aria-hidden="true">
                <Spinner size="sm" />
              </span>
            </span>
            <span
              class="attachment-download-island__action-label"
              data-state={props.pending ? "pending" : "action"}
              aria-hidden="true"
            >
              <span data-text="action">Download</span>
              <span data-text="pending">Zipping</span>
            </span>
          </span>
        </Button>
      </div>
    </div>
  );
}

export function AttachmentCards(props: {
  attachments: AttachmentSummary[];
  onPreview: (attachment: AttachmentSummary) => void;
  onAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
}) {
  const tooltipId = `attachment-action-tooltip-${createUniqueId()}`;
  const [tooltip, setTooltip] = createSignal<{ anchor: HTMLElement; content: string } | null>(null);

  const openTooltip = (anchor: HTMLElement) => {
    setTooltip({ anchor, content: "Open file" });
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
            <div class="message-attachment">
              <Button
                variant="ghost"
                type="button"
                class="attachment-preview-button"
                disabled={!canPreviewAttachment(attachment)}
                aria-label={`Preview ${attachment.name}`}
                onClick={() => props.onPreview(attachment)}
              >
                <Show
                  when={attachment.previewKind === "image"}
                  fallback={
                    <span
                      class="attachment-file-visual"
                      data-file-tone={attachmentReferenceTone(attachment.name)}
                      aria-hidden="true"
                    >
                      <AttachmentFileIcon />
                    </span>
                  }
                >
                  <span
                    class="attachment-file-visual attachment-file-image"
                    data-file-tone={attachmentReferenceTone(attachment.name)}
                  >
                    <img src={attachment.previewUrl ?? ""} alt="" />
                  </span>
                </Show>
                <span class="attachment-file-copy">
                  <strong>{attachment.name}</strong>
                  <small>{formatFileSize(attachment.size)}</small>
                </span>
              </Button>
              <Button
                variant="ghost"
                type="button"
                class="attachment-open-button"
                aria-label={`Download ${attachment.name}`}
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
                aria-label={`Open ${attachment.name}`}
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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
