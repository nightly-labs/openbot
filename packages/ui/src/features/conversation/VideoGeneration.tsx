import type { AttachmentSummary, ImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { Button, Download, Maximize2, Pause, Play, SeekSlider } from "@openbot/ui";
import { createEffect, createStore, Show } from "solid-js";
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

/** How far an arrow key moves the position, in seconds. */
const SEEK_STEP_SECONDS = 0.5;

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
  playing: boolean;
  time: number;
  duration: number;
  width: number;
  height: number;
  /** Where a drag or a key moved the position, in seconds, until the user releases it. */
  dragged: number | null;
  loading: boolean;
  /** The web client loads the file on a click, then the video plays at once. */
  playOnLoad: boolean;
  failed: boolean;
}

/** A video that an agent made: the frame while it is made, then a player with its own controls. */
export function VideoGeneration(props: VideoGenerationProps) {
  const { t, errorMessage } = useText();
  const [player, setPlayer] = createStore<VideoPlayerState>({
    playing: false,
    time: 0,
    duration: 0,
    width: 0,
    height: 0,
    dragged: null,
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
  const elapsed = () => player.dragged ?? player.time;
  const stageRatio = () => {
    if (failed()) return FAILED_MEDIA_RATIO;
    if (player.width > 0 && player.height > 0) return `${player.width} / ${player.height}`;
    return mediaRatioValue(props.aspectRatio, "video");
  };
  const label = () => {
    if (props.status === "generating") return t("chat.video.generating");
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

  const toggle = async () => {
    const attachment = props.attachment;
    if (!sourceUrl() && attachment && props.mediaSource && canLoad()) {
      if (player.loading) return;
      setPlayer((state) => {
        state.loading = true;
      });
      const loaded = await props.mediaSource.load(attachment).catch(() => false);
      setPlayer((state) => {
        state.loading = false;
        state.playOnLoad = loaded;
        state.failed = !loaded;
      });
      return;
    }
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <figure
      class="media-generation"
      data-kind="video"
      data-status={props.status}
      aria-label={t("chat.video.generation")}
      aria-live={props.status === "generating" ? "polite" : undefined}
      aria-busy={props.status === "generating" ? "true" : undefined}
    >
      <div class="media-generation-stage" style={{ "--media-generation-ratio": stageRatio() }}>
        <Show when={props.status === "generating"}>
          <MediaGenerationCanvas />
          <MediaGenerationSpecs class="media-generation-chip" values={[lengthText(), props.resolution]} />
        </Show>
        <Show when={failed()}>
          <MediaGenerationFailure />
        </Show>
        <Show when={ready()}>
          <div class="media-generation-player" data-playing={player.playing ? "" : undefined}>
            <Show when={sourceUrl()}>
              {(url) => (
                <video
                  ref={(element) => {
                    video = element;
                  }}
                  src={url()}
                  playsinline
                  preload="metadata"
                  autoplay={player.playOnLoad}
                  aria-label={props.prompt ?? t("chat.video.generated")}
                  onPlay={() =>
                    setPlayer((state) => {
                      state.playing = true;
                    })
                  }
                  onPause={() =>
                    setPlayer((state) => {
                      state.playing = false;
                    })
                  }
                  onEnded={() =>
                    setPlayer((state) => {
                      state.playing = false;
                    })
                  }
                  onTimeUpdate={(event) => {
                    const time = event.currentTarget.currentTime;
                    setPlayer((state) => {
                      state.time = time;
                    });
                  }}
                  onLoadedMetadata={(event) => {
                    const { duration, videoWidth, videoHeight } = event.currentTarget;
                    setPlayer((state) => {
                      if (Number.isFinite(duration)) state.duration = duration;
                      state.width = videoWidth;
                      state.height = videoHeight;
                    });
                  }}
                  onError={() =>
                    setPlayer((state) => {
                      state.failed = true;
                    })
                  }
                >
                  {/* A generated video has no caption track. */}
                  <track kind="captions" />
                </video>
              )}
            </Show>
            <Show when={!player.playing}>
              <Button
                variant="ghost"
                type="button"
                class="media-generation-play"
                aria-label={t("chat.video.play")}
                aria-busy={player.loading ? "true" : undefined}
                disabled={player.loading}
                onClick={() => void toggle()}
              >
                <Play aria-hidden="true" />
              </Button>
            </Show>
            <div class="media-generation-bar">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={player.playing ? t("chat.video.pause") : t("chat.video.play")}
                disabled={player.loading}
                onClick={() => void toggle()}
              >
                {player.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </Button>
              <SeekSlider
                class="media-generation-seek"
                label={t("chat.video.position")}
                value={elapsed()}
                maxValue={length()}
                step={SEEK_STEP_SECONDS}
                disabled={!sourceUrl() || player.duration <= 0}
                formatValue={(seconds) =>
                  t("chat.voice.positionValue", { elapsed: clock(seconds), duration: clock(length()) })
                }
                onChange={(seconds) =>
                  setPlayer((state) => {
                    state.dragged = seconds;
                  })
                }
                onChangeEnd={(seconds) => {
                  setPlayer((state) => {
                    state.dragged = null;
                    state.time = seconds;
                  });
                  if (video) video.currentTime = seconds;
                }}
              >
                <span
                  class="media-generation-seek-fill"
                  style={{ "--media-generation-seek": `${length() > 0 ? (elapsed() / length()) * 100 : 0}%` }}
                  aria-hidden="true"
                />
              </SeekSlider>
              {/* The slider gives the same position to a screen reader. */}
              <span class="media-generation-time" aria-hidden="true">
                {t("chat.video.time", { elapsed: clock(elapsed()), duration: clock(length()) })}
              </span>
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
            </div>
          </div>
        </Show>
      </div>
      <figcaption class="media-generation-meta">
        <span class="media-generation-label" data-shine={props.status === "generating" ? "" : undefined}>
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
