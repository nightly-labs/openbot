import type { AttachmentSummary, ImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type AttachmentMediaSource, REMOTE_PREVIEW_URL } from "./AttachmentCards";
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
import { VideoStage, type VideoStageMenu } from "./VideoStage";

export interface VideoGenerationProps {
  status: MediaGenerationStatus;
  prompt?: string | undefined;
  aspectRatio: ImageGenerationAspectRatio;
  durationSeconds?: number | undefined;
  resolution?: string | undefined;
  attachment?: AttachmentSummary | undefined;
  error?: string | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  onOpen?: ((attachment: AttachmentSummary) => void) | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
}

interface VideoPlayerState {
  duration: number;
  width: number;
  height: number;
  loading: boolean;
  playOnLoad: boolean;
  failed: boolean;
}

export function VideoGeneration(props: VideoGenerationProps) {
  const { t, format, errorMessage } = useText();
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
  const generating = () => props.status === "generating" || (props.status === "completed" && !props.attachment);
  const unavailable = () => completed() && (player.failed || (!sourceUrl() && !canLoad()));
  const failed = () => props.status === "failed" || props.status === "interrupted" || unavailable();
  const ready = () => completed() && !unavailable();
  const playbackFailed = () => completed() && player.failed;

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

  const menu = (): VideoStageMenu | undefined => {
    const attachment = props.attachment;
    if (!(ready() || playbackFailed()) || !attachment) return undefined;
    const actions = [];
    const { onOpen, onDownload } = props;
    if (onOpen)
      actions.push({
        label: t("chat.preview.preview"),
        onSelect: () => {
          video?.pause();
          onOpen(attachment);
        },
      });
    if (onDownload) actions.push({ label: t("common.download"), onSelect: () => onDownload(attachment) });
    return {
      details: [attachment.name, format.fileSize(attachment.size), size()],
      actions,
    };
  };

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

  const retry = () => {
    setPlayer((state) => {
      state.failed = false;
      state.playOnLoad = true;
    });
    if (!sourceUrl()) void load();
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
      <VideoStage ratio={stageRatio()} menu={menu()}>
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
            preload={REMOTE_PREVIEW_URL.test(sourceUrl() ?? "") ? "none" : "metadata"}
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
            fullControls
          />
        </Show>
      </VideoStage>
      <Show when={!ready()}>
        <figcaption class="media-generation-meta">
          <span class="media-generation-label" data-shine={generating() ? "" : undefined}>
            {label()}
          </span>
          <Show when={failed()}>
            <span class="media-generation-error" role="alert">
              {failure()}
            </span>
          </Show>
          <Show when={playbackFailed()}>
            <Button type="button" variant="ghost" size="xs" class="media-generation-retry" onClick={retry}>
              {t("common.retry")}
            </Button>
          </Show>
          <Show when={props.prompt}>
            <span class="media-generation-prompt">{t("chat.image.prompt", { prompt: props.prompt ?? "" })}</span>
          </Show>
        </figcaption>
      </Show>
    </figure>
  );
}
