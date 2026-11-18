import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type MediaSize, rememberedMediaSize, rememberMediaSize } from "./media-size-memory";
import { VideoPlayer } from "./VideoPlayer";
import { VideoStage, type VideoStageMenu } from "./VideoStage";

/** The shape of a video until its metadata gives the real one. */
const DEFAULT_VIDEO_RATIO = "16 / 9";

export function MediaFilePreview(props: {
  kind: "audio" | "video" | null;
  /** The address of the file. A video without one shows Play, which calls `onLoad`. */
  src: string | undefined;
  name: string;
  class?: string;
  preload?: "none" | "metadata";
  /** Plays at once: the user asked for it with the click that loaded the file. */
  autoplay?: boolean;
  /** The file starts to play. */
  onPlay?: (() => void) | undefined;
  /** Keeps the shape of a video that loaded before in this window. */
  attachmentId?: string | undefined;
  /** True while `onLoad` gets the video. */
  loading?: boolean | undefined;
  /** Gets the video when the user presses Play before there is a `src`, as in the web client. */
  onLoad?: (() => void) | undefined;
  /** The video cannot play, as with a format that the app does not know. */
  onError?: (() => void) | undefined;
  /** The details of a video, on hover, and its actions, on a right click. */
  menu?: VideoStageMenu | undefined;
}) {
  const [size, setSize] = createSignal<MediaSize | null>(untrack(() => rememberedMediaSize(props.attachmentId)));
  const { t } = useText();
  // The dimensions come last, when the video gave them, as on a generated video.
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
            {/* Local files do not provide caption tracks. */}
            <track kind="captions" />
          </audio>
        )}
      </Show>
      <Show when={props.kind === "video"}>
        {/* The same player as a generated video, not the controls of the browser. */}
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
