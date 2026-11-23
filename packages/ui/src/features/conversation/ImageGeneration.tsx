import {
  type AttachmentSummary,
  type ImageGenerationAspectRatio,
  imageAspectRatioOf,
  imagePixelSize,
} from "@openbot/contracts/ipc";
import { Button, Download, Maximize2 } from "@openbot/ui";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import {
  FAILED_MEDIA_RATIO,
  MediaGenerationCanvas,
  MediaGenerationFailure,
  MediaGenerationSpecs,
  type MediaGenerationStatus,
  mediaRatioValue,
} from "./media-generation-frame";
import { rememberedMediaSize, rememberMediaSize } from "./media-size-memory";
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
  loading?: boolean | undefined;
  onPreview?: (attachment: AttachmentSummary, origin: HTMLElement) => void;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
}

export function ImageGeneration(props: ImageGenerationProps) {
  const { t, errorMessage } = useText();
  const [previewError, setPreviewError] = createSignal(false);
  const [imageSize, setImageSize] = createSignal(untrack(() => rememberedMediaSize(props.attachment?.id)));
  const imageUrl = createSteadyImageUrl(() => props.attachment?.previewUrl);
  let image: HTMLImageElement | undefined;
  const readRatio = (element: HTMLImageElement) => {
    const { naturalHeight, naturalWidth } = element;
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const size = { width: naturalWidth, height: naturalHeight };
    setImageSize(size);
    const id = props.attachment?.id;
    if (id) rememberMediaSize(id, size);
  };
  createEffect(
    () => imageUrl(),
    () => {
      setPreviewError(false);
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
  const knownSize = () => imageSize() ?? imagePixelSize(props.resolution);
  const size = () => {
    const known = knownSize();
    return known ? t("chat.media.size", { width: known.width, height: known.height }) : props.resolution;
  };
  const frameSize = () => {
    const loaded = imageSize();
    if (loaded) return loaded;
    const host = imagePixelSize(props.resolution);
    return host && imageAspectRatioOf(host) === props.aspectRatio ? host : null;
  };
  const stageRatio = () => {
    const known = frameSize();
    if (hasFailure() && !isAttachment()) return FAILED_MEDIA_RATIO;
    if (props.status === "completed" && known) return `${known.width} / ${known.height}`;
    return mediaRatioValue(props.aspectRatio, "image");
  };
  const preview = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    if (props.attachment) props.onPreview?.(props.attachment, event.currentTarget);
  };
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
