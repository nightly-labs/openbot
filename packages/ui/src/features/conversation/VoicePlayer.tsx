import { Button, Pause, Play, SeekSlider } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

/** How many bars the waveform has. */
const BAR_COUNT = 40;
/** The waveform of a recording that is not decoded, or of a reply that was not read to its end. */
const PLACEHOLDER_PEAKS: readonly number[] = new Array(BAR_COUNT).fill(0);
/** How far an arrow key moves the position, in seconds. A page key moves it ten times as far. */
const SEEK_STEP_SECONDS = 0.5;

export interface VoicePlayerProps {
  /** `message` plays the user's own recording; `reply` reads the agent's answer aloud. */
  kind: "message" | "reply";
  state: "idle" | "playing" | "paused";
  /**
   * The shape of the recording, from 0 to 1. Missing until the recording is decoded, and for a reply
   * until it was read to its end once, because it is synthesized while it plays.
   */
  peaks?: readonly number[] | undefined;
  /** The length and how far it played, in seconds. A reply has a length when it has peaks. */
  duration?: number | undefined;
  elapsed?: number | undefined;
  /** For a reply without peaks: the loudness of the voice while it is read, oldest first, from 0 to 1. */
  levels?: readonly number[] | undefined;
  onToggle: () => void;
  /** Moves a recording to a position, in seconds, and plays it from there. */
  onSeek?: ((seconds: number) => void) | undefined;
}

/** Plays a spoken turn in its message: the user's recording, or the agent's reply read aloud. */
export function VoicePlayer(props: VoicePlayerProps) {
  const { t } = useText();
  /** Where a drag or a key moved the position, in seconds, until the user releases it. */
  const [dragged, setDragged] = createSignal<number | null>(null);
  const active = () => props.state !== "idle";
  const duration = () => props.duration ?? 0;
  const elapsed = () => {
    const drag = dragged();
    return drag ?? props.elapsed ?? 0;
  };
  const progress = () => (duration() > 0 ? elapsed() / duration() : 0);
  /** A reply that is read for the first time shows the loudness of its voice, newest at the end. */
  const live = () => !props.peaks && active() && props.levels !== undefined;
  const bars = (): readonly number[] => {
    if (props.peaks) return props.peaks;
    const levels = live() ? (props.levels ?? []) : [];
    return [...PLACEHOLDER_PEAKS.slice(levels.length), ...levels.slice(-BAR_COUNT)];
  };
  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.round(seconds));
    return t("chat.voice.duration", {
      minutes: Math.floor(whole / 60),
      seconds: String(whole % 60).padStart(2, "0"),
    });
  };
  const toggleLabel = () => {
    if (props.kind === "reply") {
      if (props.state === "playing") return t("chat.voice.pauseReading");
      return props.state === "paused" ? t("chat.voice.resumeReading") : t("chat.actions.readAloud");
    }
    return props.state === "playing" ? t("chat.voice.pause") : t("chat.voice.play");
  };
  return (
    <div class="voice-player" data-kind={props.kind} data-state={props.state}>
      <Button
        variant="default"
        size="icon-xs"
        type="button"
        class="voice-player-toggle"
        aria-label={toggleLabel()}
        title={toggleLabel()}
        onClick={() => props.onToggle()}
      >
        {props.state === "playing" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </Button>
      <SeekSlider
        class="voice-player-track"
        label={t("chat.voice.position")}
        value={elapsed()}
        maxValue={duration()}
        step={SEEK_STEP_SECONDS}
        disabled={props.duration === undefined}
        formatValue={(seconds) =>
          t("chat.voice.positionValue", { elapsed: clock(seconds), duration: clock(duration()) })
        }
        onChange={(seconds) => setDragged(seconds)}
        onChangeEnd={(seconds) => {
          setDragged(null);
          props.onSeek?.(seconds);
        }}
      >
        <span class="voice-player-bars" aria-hidden="true">
          <For each={bars()} keyed={false}>
            {(peak, index) => (
              <span
                class="voice-player-bar"
                data-played={
                  live() || ((active() || dragged() !== null) && (index + 0.5) / bars().length <= progress())
                    ? "true"
                    : undefined
                }
                style={{ "--voice-peak": String(peak()) }}
              />
            )}
          </For>
        </span>
      </SeekSlider>
      <Show when={active() || props.duration !== undefined}>
        <span class="voice-player-time">{clock(active() ? elapsed() : duration())}</span>
      </Show>
    </div>
  );
}
