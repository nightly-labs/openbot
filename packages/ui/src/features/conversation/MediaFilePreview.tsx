import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type MediaSize, rememberedMediaSize, rememberMediaSize } from "./media-size-memory";
import { VideoPlayer } from "./VideoPlayer";
import { VideoStage, type VideoStageMenu } from "./VideoStage";

const DEFAULT_VIDEO_RATIO = "16 / 9";

export function MediaFilePreview(props: {
  kind: "audio" | "video" | null;
  src: string | undefined;
  name: string;
  class?: string;
  preload?: "none" | "metadata";
  autoplay?: boolean;
  onPlay?: (() => void) | undefined;
  attachmentId?: string | undefined;
  loading?: boolean | undefined;
  onLoad?: (() => void) | undefined;
  onError?: (() => void) | undefined;
  menu?: VideoStageMenu | undefined;
}) {
  const [size, setSize] = createSignal<MediaSize | null>(untrack(() => rememberedMediaSize(props.attachmentId)));
  const { t } = useText();
  const menu = (): VideoStageMenu | undefined => {
    const base = props.menu;
    const known = size();
    if (!base || !known) return base;
    return { ...base, details: [...base.details, t("chat.media.size", { width: known.width, height: known.height })] };
  };
  const ratio = () => {
    const known = size();
    return known ? `${known.width} / ${known.height}` : DEFAULT_VIDEO_RATIO;
  };

  return (
    <>
      <Show when={props.kind === "audio" && props.src}>
        {(url) => (
          <audio
            class={props.class}
            controls
            autoplay={props.autoplay}
            preload={props.preload}
            src={url()}
            aria-label={props.name}
            onPlay={() => props.onPlay?.()}
          >
            <track kind="captions" />
          </audio>
        )}
      </Show>
      <Show when={props.kind === "video"}>
        <VideoStage class={props.class} ratio={ratio()} menu={menu()}>
          <VideoPlayer
            src={props.src}
            label={props.name}
            autoplay={props.autoplay}
            preload={props.preload}
            loading={props.loading}
            onLoad={props.onLoad}
            onPlay={props.onPlay}
            onError={props.onError}
            fullControls
            onMetadata={(video) => {
              const next = { width: video.videoWidth, height: video.videoHeight };
              if (next.width <= 0 || next.height <= 0) return;
              setSize(next);
              if (props.attachmentId) rememberMediaSize(props.attachmentId, next);
            }}
          />
        </VideoStage>
      </Show>
    </>
  );
}
