import type { DraftAttachment } from "@openbot/contracts/ipc";
import { Button, CircleAlert, ImageRemoveButton, RadialProgress, RotateCcw, Spinner } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { fileBadge } from "./AttachmentCards";
import { attachmentReferenceTone } from "./AttachmentReference";
import { ImageLightbox, type ImageLightboxOpening, isLightboxImage } from "./ImageLightbox";

export interface ComposerPendingImage {
  id: string;
  name: string;
  url: string;
}

export interface ComposerUploadFile {
  key: string;
  uploadId: string;
  name: string;
  size: number;
  sent: number | null;
  error: string | null;
}

export function ComposerAttachmentRow(props: {
  attachments: readonly DraftAttachment[];
  pending?: readonly ComposerPendingImage[] | undefined;
  uploads?: readonly ComposerUploadFile[] | undefined;
  removeDisabled?: boolean | undefined;
  onRemove: (attachment: DraftAttachment) => void;
  onRemoveUpload?: ((uploadId: string) => void) | undefined;
  onRetryUpload?: ((uploadId: string) => void) | undefined;
  macWindowControls?: boolean | undefined;
}) {
  const { t, format } = useText();
  const [lightbox, setLightbox] = createSignal<ImageLightboxOpening | null>(null);
  let row: HTMLDivElement | undefined;
  const thumbnail = (attachment: DraftAttachment) =>
    row?.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(attachment.id)}"]`) ?? undefined;
  const openImage = (attachment: DraftAttachment, origin: HTMLElement) => {
    const images = props.attachments.filter(opensInViewer);
    setLightbox({ images, index: images.findIndex((image) => image.id === attachment.id), origin });
  };
  return (
    <Show when={props.attachments.length > 0 || (props.pending?.length ?? 0) > 0 || (props.uploads?.length ?? 0) > 0}>
      <div ref={row} class="composer-attachments">
        <For each={props.attachments}>
          {(attachment) => {
            const chip = () => (attachment.kind === "image" && attachment.previewUrl ? "image" : "file");
            return (
              <div class="composer-attachment ui-removable-image" data-kind={chip()}>
                <Show
                  when={opensInViewer(attachment)}
                  fallback={
                    <span
                      class="composer-attachment-preview"
                      data-file-tone={chip() === "file" ? attachmentReferenceTone(attachment.name) : undefined}
                    >
                      <Show when={chip() === "image"} fallback={fileBadge(attachment)}>
                        <img src={attachment.previewUrl ?? ""} alt="" />
                      </Show>
                    </span>
                  }
                >
                  <Button
                    variant="ghost"
                    type="button"
                    class="composer-attachment-preview"
                    data-attachment-id={attachment.id}
                    aria-label={t("chat.image.preview", { name: attachment.name })}
                    data-cuelume-tap="open"
                    onClick={(event) => openImage(attachment, event.currentTarget)}
                  >
                    <img src={attachment.previewUrl ?? ""} alt="" />
                  </Button>
                </Show>
                <Show when={chip() === "file"}>
                  <span class="composer-attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{format.fileSize(attachment.size)}</small>
                  </span>
                </Show>
                <ImageRemoveButton
                  label={t("composer.attachment.remove", { name: attachment.name })}
                  disabled={props.removeDisabled === true}
                  onClick={() => props.onRemove(attachment)}
                />
              </div>
            );
          }}
        </For>
        <For each={props.uploads ?? []} keyed={(upload) => upload.key}>
          {(upload) => (
            <ComposerUploadChip upload={upload()} onRemove={props.onRemoveUpload} onRetry={props.onRetryUpload} />
          )}
        </For>
        <For each={props.pending ?? []}>
          {(image) => (
            <div class="composer-attachment" data-kind="image" data-pending="">
              <span class="composer-attachment-preview">
                <img src={image.url} alt="" />
              </span>
              <Spinner size="sm" label={t("composer.attachment.adding", { name: image.name })} />
            </div>
          )}
        </For>
        <Show when={lightbox()}>
          {(opening) => (
            <ImageLightbox
              opening={opening()}
              thumbnail={thumbnail}
              macWindowControls={props.macWindowControls}
              onClose={() => setLightbox(null)}
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

function opensInViewer(attachment: DraftAttachment): boolean {
  return attachment.kind === "image" && isLightboxImage(attachment);
}

function ComposerUploadChip(props: {
  upload: ComposerUploadFile;
  onRemove: ((uploadId: string) => void) | undefined;
  onRetry: ((uploadId: string) => void) | undefined;
}) {
  const { t, format } = useText();
  const failed = () => props.upload.error !== null;
  const percent = () => {
    const { sent, size } = props.upload;
    return sent === null || size <= 0 ? null : Math.round((Math.min(sent, size) / size) * 100);
  };
  const detail = () => {
    const { error, sent, size } = props.upload;
    if (error !== null) return error || t("composer.upload.failed");
    if (sent === null) return format.fileSize(size);
    return t("composer.upload.progress", { sent: format.fileSize(sent), total: format.fileSize(size) });
  };
  const uploadingLabel = () => t("composer.upload.uploading", { name: props.upload.name });
  return (
    <div
      class="composer-attachment ui-removable-image"
      data-kind="file"
      data-upload={failed() ? "failed" : "uploading"}
    >
      <span
        class="composer-attachment-preview"
        data-file-tone={failed() ? undefined : attachmentReferenceTone(props.upload.name)}
      >
        <Show when={!failed()} fallback={<CircleAlert class="composer-upload-failed-icon" aria-hidden="true" />}>
          <Show when={percent() !== null} fallback={<Spinner size="sm" label={uploadingLabel()} />}>
            <RadialProgress class="composer-upload-ring" value={percent() ?? 0} aria-label={uploadingLabel()} />
          </Show>
        </Show>
      </span>
      <span class="composer-attachment-copy">
        <strong title={props.upload.name}>{props.upload.name}</strong>
        <small title={detail()}>{detail()}</small>
      </span>
      <Show when={failed() && props.onRetry}>
        {(retry) => (
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            class="composer-upload-retry"
            aria-label={t("composer.upload.retry", { name: props.upload.name })}
            title={t("composer.upload.retry", { name: props.upload.name })}
            onClick={() => retry()(props.upload.uploadId)}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        )}
      </Show>
      <Show when={props.onRemove}>
        {(remove) => (
          <ImageRemoveButton
            label={t("composer.attachment.remove", { name: props.upload.name })}
            onClick={() => remove()(props.upload.uploadId)}
          />
        )}
      </Show>
    </div>
  );
}
