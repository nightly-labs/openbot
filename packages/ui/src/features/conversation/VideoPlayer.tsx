import { Button, Maximize2, Minimize2, Pause, Play, SeekSlider, Volume2, VolumeX } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, Show } from "solid-js";
import { useText } from "../../text";

/** How far an arrow key moves the position, in seconds. */
const SEEK_STEP_SECONDS = 0.5;

export interface VideoPlayerProps {
  /** The address of the file. Without one, Play calls `onLoad`. */
  src: string | undefined;
  label: string;
  /** The length to show until the video gives its own. */
  durationSeconds?: number | undefined;
  autoplay?: boolean | undefined;
  /** True while `onLoad` gets the file. */
  loading?: boolean | undefined;
  /** Gets the file when the user presses Play before there is a `src`, as in the web client. */
  onLoad?: (() => void) | undefined;
  onMetadata?: ((video: HTMLVideoElement) => void) | undefined;
  onError?: (() => void) | undefined;
  ref?: ((video: HTMLVideoElement) => void) | undefined;
  /**
   * Adds a mute button and a full screen button to the bar. Full screen fills the app window, as a
   * page in the chat does: the player is a manual popover, so it goes to the top layer without a move
   * in the document and plays on.
   */
  fullControls?: boolean | undefined;
  /** Buttons at the end of the bar, such as Download. */
  children?: JSX.Element;
}

interface VideoPlayerState {
  playing: boolean;
  time: number;
  duration: number;
  /** Where a drag or a key moved the position, in seconds, until the user releases it. */
  dragged: number | null;
  muted: boolean;
  fullScreen: boolean;
}

/** A video with a play button over the frame, and a bar with the position and the actions at the bottom. */
export function VideoPlayer(props: VideoPlayerProps) {
  const { t } = useText();
  const [player, setPlayer] = createStore<VideoPlayerState>({
    playing: false,
    time: 0,
    duration: 0,
    dragged: null,
    muted: false,
    fullScreen: false,
  });
  let video: HTMLVideoElement | undefined;
  let frame: HTMLDivElement | undefined;

  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.round(seconds));
    return t("chat.voice.duration", { minutes: Math.floor(whole / 60), seconds: String(whole % 60).padStart(2, "0") });
  };
  const length = () => player.duration || props.durationSeconds || 0;
  const elapsed = () => player.dragged ?? player.time;
  const setPlaying = (playing: boolean) =>
    setPlayer((state) => {
      state.playing = playing;
    });

  const toggle = () => {
    if (!props.src) {
      if (!props.loading) props.onLoad?.();
      return;
    }
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const toggleSound = () => {
    if (video) video.muted = !video.muted;
  };
  const toggleFullScreen = () => {
    if (!frame) return;
    if (frame.matches(":popover-open")) frame.hidePopover();
    else frame.showPopover();
  };
  // Escape leaves full screen. The window gets the key while the focus is outside the player.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    frame?.hidePopover();
  };
  onCleanup(() => window.removeEventListener("keydown", onEscape));

  return (
    <div
      ref={frame}
      class="media-generation-player"
      data-playing={player.playing ? "" : undefined}
      popover={props.fullControls ? "manual" : undefined}
      onToggle={(event) => {
        const open = event.newState === "open";
        if (open) window.addEventListener("keydown", onEscape);
        else window.removeEventListener("keydown", onEscape);
        setPlayer((state) => {
          state.fullScreen = open;
        });
      }}
    >
      <Show when={props.src}>
        {(url) => (
          <video
            ref={(element) => {
              video = element;
              props.ref?.(element);
            }}
            src={url()}
            playsinline
            preload="metadata"
            autoplay={props.autoplay}
            aria-label={props.label}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onVolumeChange={(event) => {
              const { muted } = event.currentTarget;
              setPlayer((state) => {
                state.muted = muted;
              });
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setPlayer((state) => {
                state.time = time;
              });
            }}
            onLoadedMetadata={(event) => {
              const { duration } = event.currentTarget;
              setPlayer((state) => {
                if (Number.isFinite(duration)) state.duration = duration;
              });
              props.onMetadata?.(event.currentTarget);
            }}
            onError={() => props.onError?.()}
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
          aria-busy={props.loading ? "true" : undefined}
          disabled={props.loading}
          onClick={toggle}
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
          disabled={props.loading}
          onClick={toggle}
        >
          {player.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <SeekSlider
          class="media-generation-seek"
          label={t("chat.video.position")}
          value={elapsed()}
          maxValue={length()}
          step={SEEK_STEP_SECONDS}
          disabled={!props.src || player.duration <= 0}
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
        <Show when={props.fullControls}>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={player.muted ? t("chat.video.unmute") : t("chat.video.mute")}
            aria-pressed={player.muted ? "true" : "false"}
            disabled={!props.src}
            onClick={toggleSound}
          >
            {player.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={player.fullScreen ? t("chat.visual.exitFullScreen") : t("chat.visual.fullScreen")}
            disabled={!props.src}
            onClick={toggleFullScreen}
          >
            {player.fullScreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </Button>
        </Show>
        {props.children}
      </div>
    </div>
  );
}
