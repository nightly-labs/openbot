import { Button, Maximize2, Minimize2, Pause, Play, SeekSlider, Spinner, Volume2, VolumeX } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, Show } from "solid-js";
import { useText } from "../../text";

/** How far an arrow key moves the position, in seconds. */
const SEEK_STEP_SECONDS = 0.5;
const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2];

export interface VideoPlayerProps {
  /** The address of the file. Without one, Play calls `onLoad`. */
  src: string | undefined;
  label: string;
  /** The length to show until the video gives its own. */
  durationSeconds?: number | undefined;
  autoplay?: boolean | undefined;
  /** "none" gets nothing before Play, for a file that arrives whole. The default is "metadata". */
  preload?: "none" | "metadata" | undefined;
  /** True while `onLoad` gets the file. */
  loading?: boolean | undefined;
  /** Gets the file when the user presses Play before there is a `src`, as in the web client. */
  onLoad?: (() => void) | undefined;
  onMetadata?: ((video: HTMLVideoElement) => void) | undefined;
  /** The video starts, from Play or from `autoplay`. */
  onPlay?: (() => void) | undefined;
  onError?: (() => void) | undefined;
  ref?: ((video: HTMLVideoElement) => void) | undefined;
  /**
   * Adds playback speed, mute, and full screen buttons to the bar. Full screen fills the app window, as a
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
  speed: number;
  fullScreen: boolean;
  /** True while the video has no data to show at its position: it plays, but the picture stays. */
  buffering: boolean;
}

/** A video with a play button over the frame, and a bar with the position and the actions at the bottom. */
export function VideoPlayer(props: VideoPlayerProps) {
  const { t, format } = useText();
  const [player, setPlayer] = createStore<VideoPlayerState>({
    playing: false,
    time: 0,
    duration: 0,
    dragged: null,
    muted: false,
    speed: 1,
    fullScreen: false,
    buffering: false,
  });
  let video: HTMLVideoElement | undefined;
  let frame: HTMLDivElement | undefined;

  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.round(seconds));
    return t("chat.voice.duration", { minutes: Math.floor(whole / 60), seconds: String(whole % 60).padStart(2, "0") });
  };
  const length = () => player.duration || props.durationSeconds || 0;
  const elapsed = () => player.dragged ?? player.time;
  const speed = () => format.number(player.speed);
  const setPlaying = (playing: boolean) =>
    setPlayer((state) => {
      state.playing = playing;
      if (!playing) state.buffering = false;
    });
  const setBuffering = (buffering: boolean) =>
    setPlayer((state) => {
      state.buffering = buffering;
    });
  // A video from a joined server arrives as a whole file, so Play can wait for many seconds. Without
  // a sign, the player looks frozen.
  const waiting = () => player.playing && player.buffering;

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
  const cycleSpeed = () => {
    if (!props.src || !video) return;
    const current = PLAYBACK_SPEEDS.indexOf(video.playbackRate);
    video.playbackRate = PLAYBACK_SPEEDS[(current + 1) % PLAYBACK_SPEEDS.length] ?? 1;
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
      aria-busy={waiting() || props.loading ? "true" : undefined}
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
            preload={props.preload ?? "metadata"}
            autoplay={props.autoplay}
            aria-label={props.label}
            onPlay={() => {
              setPlaying(true);
              props.onPlay?.();
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onLoadStart={(event) => {
              // The same player can load a different video, so reset the rate and its label together.
              event.currentTarget.playbackRate = 1;
              setPlayer((state) => {
                state.speed = 1;
              });
            }}
            onRateChange={(event) => {
              const rate = event.currentTarget.playbackRate;
              setPlayer((state) => {
                state.speed = rate;
              });
            }}
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
            onError={() => {
              setBuffering(false);
              props.onError?.();
            }}
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
          <Show when={props.loading} fallback={<Play aria-hidden="true" />}>
            <Spinner />
          </Show>
        </Button>
      </Show>
      <Show when={waiting()}>
        <span class="media-generation-wait">
          <Spinner label={t("common.loading")} />
        </span>
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
            size="xs"
            type="button"
            class="media-generation-speed"
            aria-label={t("chat.voice.speedLabel", { speed: speed() })}
            title={t("chat.voice.speed")}
            disabled={!props.src}
            onClick={cycleSpeed}
          >
            {t("chat.voice.speedValue", { speed: speed() })}
          </Button>
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
