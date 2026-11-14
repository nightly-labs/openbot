import type { AttachmentSummary, ImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { Button, Download, Maximize2 } from "@openbot/ui";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { useText } from "../../text";
import type { AttachmentMediaSource } from "./AttachmentCards";
import {
  FAILED_MEDIA_RATIO,
  MediaGenerationCanvas,
  MediaGenerationFailure,
  MediaGenerationSpecs,
  type MediaGenerationStatus,
  mediaRatioValue,
} from "./media-generation-frame";
import { rememberedMediaSize, rememberMediaSize } from "./media-size-memory";
import { VideoPlayer } from "./VideoPlayer";

export interface VideoGenerationProps {
  status: MediaGenerationStatus;
  prompt?: string | undefined;
  aspectRatio: ImageGenerationAspectRatio;
  /** The length that the model was asked for, until the video gives its real length. */
  durationSeconds?: number | undefined;
  /** The resolution that the model was asked for, such as "720p", until the video gives its size. */
  resolution?: string | undefined;
  attachment?: AttachmentSummary | undefined;
  error?: string | undefined;
  /** Reads a video that has no `previewUrl`, as in the web client. */
  mediaSource?: AttachmentMediaSource | undefined;
  onOpen?: ((attachment: AttachmentSummary) => void) | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
}

interface VideoPlayerState {
  duration: number;
  width: number;
  height: number;
  loading: boolean;
  /** The web client loads the file on a click, then the video plays at once. */
  playOnLoad: boolean;
  failed: boolean;
}

/** A video that an agent made: the frame while it is made, then a player with its own controls. */
export function VideoGeneration(props: VideoGenerationProps) {
  const { t, errorMessage } = useText();
  // A video that loaded before in this window has its shape before its metadata loads again.
  const remembered = untrack(() => rememberedMediaSize(props.attachment?.id));
  const [player, setPlayer] = createStore<VideoPlayerState>({
    duration: 0,
    width: remembered?.width ?? 0,
    height: remembered?.height ?? 0,
    loading: false,
    playOnLoad: false,
    failed: false,
  });
  let video: HTMLVideoElement | undefined;

  const sourceUrl = () => {
    const attachment = props.attachment;
    if (!attachment) return undefined;
    return attachment.previewUrl ?? props.mediaSource?.url(attachment.id);
  };
  const canLoad = () => {
    const attachment = props.attachment;
    const source = props.mediaSource;
    return Boolean(attachment && !attachment.previewUrl && source && attachment.size <= source.mediaLimit);
  };
  const completed = () => props.status === "completed" && Boolean(props.attachment);
  // The host marks the video completed, then copies its file. The copy ends with the file or with a
  // failure, so the frame stays until then.
  const generating = () => props.status === "generating" || (props.status === "completed" && !props.attachment);
  const unavailable = () => completed() && (player.failed || (!sourceUrl() && !canLoad()));
  const failed = () => props.status === "failed" || props.status === "interrupted" || unavailable();
  const ready = () => completed() && !unavailable();

  createEffect(
    () => sourceUrl(),
    () => {
      setPlayer((state) => {
        state.failed = false;
      });
    },
  );

  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.round(seconds));
    return t("chat.voice.duration", { minutes: Math.floor(whole / 60), seconds: String(whole % 60).padStart(2, "0") });
  };
  const length = () => player.duration || props.durationSeconds || 0;
  const size = () =>
    player.width > 0 && player.height > 0
      ? t("chat.media.size", { width: player.width, height: player.height })
      : props.resolution;
  const lengthText = () => (length() > 0 ? clock(length()) : undefined);
  const stageRatio = () => {
    if (failed()) return FAILED_MEDIA_RATIO;
    if (player.width > 0 && player.height > 0) return `${player.width} / ${player.height}`;
    return mediaRatioValue(props.aspectRatio, "video");
  };
  const label = () => {
    if (generating()) return t("chat.video.generating");
    if (unavailable()) return t("chat.video.unavailable");
    if (props.status === "interrupted") return t("chat.video.interrupted");
    if (props.status === "failed") return t("chat.video.failed");
    return t("chat.video.generated");
  };
  const failure = () =>
    unavailable()
      ? t("chat.video.previewUnavailable")
      : errorMessage(
          props.error,
          props.status === "interrupted" ? t("chat.video.wasInterrupted") : t("chat.video.didNotComplete"),
        );

  /** The web client loads the file on Play, then the video plays at once. */
  const load = async () => {
    const attachment = props.attachment;
    if (!attachment || !props.mediaSource || !canLoad() || player.loading) return;
    setPlayer((state) => {
      state.loading = true;
    });
    const loaded = await props.mediaSource.load(attachment).catch(() => false);
    setPlayer((state) => {
      state.loading = false;
      state.playOnLoad = loaded;
      state.failed = !loaded;
    });
  };

  return (
    <figure
      class="media-generation"
      data-kind="video"
      data-status={generating() ? "generating" : props.status}
      aria-label={t("chat.video.generation")}
      aria-live={generating() ? "polite" : undefined}
      aria-busy={generating() ? "true" : undefined}
    >
      <div class="media-generation-stage" style={{ "--media-generation-ratio": stageRatio() }}>
        <Show when={generating()}>
          <MediaGenerationCanvas />
          <MediaGenerationSpecs class="media-generation-chip" values={[lengthText(), props.resolution]} />
        </Show>
        <Show when={failed()}>
          <MediaGenerationFailure />
        </Show>
        <Show when={ready()}>
          <VideoPlayer
            src={sourceUrl()}
            label={props.prompt ?? t("chat.video.generated")}
            durationSeconds={props.durationSeconds}
            autoplay={player.playOnLoad}
            loading={player.loading}
            onLoad={() => void load()}
            onMetadata={(element) => {
              const { duration, videoWidth, videoHeight } = element;
              setPlayer((state) => {
                if (Number.isFinite(duration)) state.duration = duration;
                state.width = videoWidth;
                state.height = videoHeight;
              });
              const id = props.attachment?.id;
              if (id) rememberMediaSize(id, { width: videoWidth, height: videoHeight });
            }}
            onError={() =>
              setPlayer((state) => {
                state.failed = true;
              })
            }
            ref={(element) => {
              video = element;
            }}
          >
            <Show when={props.attachment && props.onDownload}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={t("chat.video.download")}
                title={t("chat.video.download")}
                onClick={() => {
                  if (props.attachment) props.onDownload?.(props.attachment);
                }}
              >
                <Download aria-hidden="true" />
              </Button>
            </Show>
            <Show when={props.attachment && props.onOpen}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={t("chat.video.open")}
                title={t("chat.video.open")}
                data-attachment-id={props.attachment?.id}
                onClick={() => {
                  video?.pause();
                  if (props.attachment) props.onOpen?.(props.attachment);
                }}
              >
                <Maximize2 aria-hidden="true" />
              </Button>
            </Show>
          </VideoPlayer>
        </Show>
      </div>
      <figcaption class="media-generation-meta">
        <span class="media-generation-label" data-shine={generating() ? "" : undefined}>
          {label()}
          <Show when={ready()}>
            <MediaGenerationSpecs class="media-generation-specs" values={[lengthText(), size()]} />
          </Show>
        </span>
        <Show when={failed()}>
          <span class="media-generation-error" role="alert">
            {failure()}
          </span>
        </Show>
        <Show when={props.prompt}>
          <span class="media-generation-prompt">{t("chat.image.prompt", { prompt: props.prompt ?? "" })}</span>
        </Show>
      </figcaption>
    </figure>
  );
}
