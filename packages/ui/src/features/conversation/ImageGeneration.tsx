import type { AttachmentSummary, ImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { Button, Download, Maximize2 } from "@openbot/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import {
  FAILED_MEDIA_RATIO,
  MediaGenerationCanvas,
  MediaGenerationFailure,
  MediaGenerationSpecs,
  type MediaGenerationStatus,
  mediaRatioValue,
} from "./media-generation-frame";
import { createSteadyImageUrl } from "./steady-image-url";

export type ImageGenerationStatus = MediaGenerationStatus;
export interface ImageGenerationProps {
  status: ImageGenerationStatus;
  presentation?: "generated" | "attachment";
  prompt?: string | undefined;
  resolution?: string;
  aspectRatio: ImageGenerationAspectRatio;
  attachment?: AttachmentSummary | undefined;
  error?: string | undefined;
  /**
   * The image file is on its way, such as a file that the web client reads from the host. The stage
   * shows its dots at the size of the image, so the chat does not grow when the image shows.
   */
  loading?: boolean | undefined;
  /** `origin` is the clicked image, for a viewer that zooms out of it. */
  onPreview?: (attachment: AttachmentSummary, origin: HTMLElement) => void;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
}

export function ImageGeneration(props: ImageGenerationProps) {
  const { t, errorMessage } = useText();
  const [previewError, setPreviewError] = createSignal(false);
  // The ratio stays when the URL changes: a sent image gets the URL of its stored copy, and the
  // image keeps its size and pixels until that copy loads.
  const [imageSize, setImageSize] = createSignal<{ width: number; height: number } | null>(null);
  const imageUrl = createSteadyImageUrl(() => props.attachment?.previewUrl);
  let image: HTMLImageElement | undefined;
  const readRatio = (element: HTMLImageElement) => {
    const { naturalHeight, naturalWidth } = element;
    if (naturalWidth > 0 && naturalHeight > 0) setImageSize({ width: naturalWidth, height: naturalHeight });
  };
  // Keyed by the drawn URL: a URL that failed is not tried again while the new one loads.
  createEffect(
    () => imageUrl(),
    () => {
      setPreviewError(false);
      // An image in the memory cache, such as one the composer showed, is complete at once. A lazy
      // image fires `load` frames later, and the box would be square until then.
      if (image?.complete) readRatio(image);
    },
  );

  const previewUnavailable = () =>
    props.status === "completed" && !props.attachment?.previewUrl && props.loading !== true;
  const isAttachment = () => props.presentation === "attachment";
  const hasImage = () => props.status === "completed" && Boolean(props.attachment?.previewUrl) && !previewError();
  const hasFailure = () =>
    props.status === "failed" || props.status === "interrupted" || previewError() || previewUnavailable();
  const failure = () =>
    previewError() || previewUnavailable()
      ? isAttachment()
        ? t("chat.image.previewUnavailable")
        : t("chat.image.generatedPreviewUnavailable")
      : errorMessage(
          props.error,
          props.status === "interrupted" ? t("chat.image.wasInterrupted") : t("chat.image.didNotComplete"),
        );
  const label = () => {
    if (props.status === "generating") return t("chat.image.generating");
    if (previewError() || previewUnavailable()) return t("chat.image.unavailable");
    if (props.status === "interrupted") return t("chat.image.interrupted");
    if (props.status === "failed") return t("chat.image.failed");
    return isAttachment() ? t("chat.image.attached") : t("chat.image.generated");
  };
  const previewLabel = () =>
    isAttachment()
      ? t("chat.image.preview", { name: props.attachment?.name ?? t("chat.image.attachedFallback") })
      : t("chat.image.previewGenerated");
  const downloadLabel = () =>
    isAttachment()
      ? t("chat.image.download", { name: props.attachment?.name ?? t("chat.image.attachedFallback") })
      : t("chat.image.downloadGenerated");
  /** The real size of the image once it loads. The size that the model was asked for until then. */
  const size = () => {
    const loaded = imageSize();
    return loaded ? t("chat.media.size", { width: loaded.width, height: loaded.height }) : props.resolution;
  };
  const stageRatio = () => {
    const loaded = imageSize();
    if (hasImage() && loaded) return `${loaded.width} / ${loaded.height}`;
    if (hasFailure() && !isAttachment()) return FAILED_MEDIA_RATIO;
    return mediaRatioValue(props.aspectRatio, "image");
  };
  const preview = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    if (props.attachment) props.onPreview?.(props.attachment, event.currentTarget);
  };
  /** An attached image shows alone. A generated image says what it is under it. */
  const showsMeta = () => props.loading !== true && (!hasImage() || !isAttachment());

  return (
    <section
      class={[
        "image-generation",
        {
          "image-generation-ready": hasImage(),
          "image-generation-failed": hasFailure(),
        },
      ]}
      data-status={props.status}
      aria-label={hasImage() ? label() : isAttachment() ? t("chat.image.attachment") : t("chat.image.generation")}
      aria-live={props.status === "generating" ? "polite" : undefined}
    >
      <div class="image-generation-stage" style={`--image-generation-ratio: ${stageRatio()}`}>
        <Show when={!hasImage()}>
          <div
            class="image-generation-state"
            role="img"
            aria-label={label()}
            aria-busy={props.status === "generating" || props.loading === true ? "true" : undefined}
          >
            <Show when={hasFailure()} fallback={<MediaGenerationCanvas />}>
              <MediaGenerationFailure />
            </Show>
          </div>
        </Show>
        <Show when={props.status === "generating"}>
          <MediaGenerationSpecs class="media-generation-chip" values={[props.resolution]} />
        </Show>
        <Show when={Boolean(props.attachment?.previewUrl) && !previewError()}>
          <Button
            variant="ghost"
            type="button"
            class={["image-generation-preview", { "image-generation-preview-visible": hasImage() }]}
            aria-label={previewLabel()}
            data-attachment-id={props.attachment?.id}
            onClick={preview}
          >
            <img
              src={imageUrl() ?? ""}
              alt={props.prompt ?? t("chat.image.generated")}
              loading="lazy"
              decoding="async"
              ref={(element) => {
                image = element;
              }}
              onLoad={(event) => readRatio(event.currentTarget)}
              onError={() => setPreviewError(true)}
            />
          </Button>
        </Show>
        <Show when={hasImage() && props.attachment && props.onDownload}>
          <div class="media-generation-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={downloadLabel()}
              title={downloadLabel()}
              onClick={(event) => {
                event.stopPropagation();
                if (props.attachment) props.onDownload?.(props.attachment);
              }}
            >
              <Download aria-hidden="true" />
            </Button>
            <Show when={props.onPreview}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={previewLabel()}
                title={previewLabel()}
                onClick={preview}
              >
                <Maximize2 aria-hidden="true" />
              </Button>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={showsMeta()}>
        <div class="media-generation-meta">
          <span class="media-generation-label" data-shine={props.status === "generating" ? "" : undefined}>
            {label()}
            <Show when={hasImage()}>
              <MediaGenerationSpecs class="media-generation-specs" values={[size()]} />
            </Show>
          </span>
          <Show when={hasFailure()}>
            <span class="media-generation-error" role="alert">
              {failure()}
            </span>
          </Show>
          <Show when={props.prompt}>
            <span class="media-generation-prompt">{t("chat.image.prompt", { prompt: props.prompt ?? "" })}</span>
          </Show>
        </div>
      </Show>
    </section>
  );
}
