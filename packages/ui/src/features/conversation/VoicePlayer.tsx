import { Button, Pause, Play, SeekSlider } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

const BAR_COUNT = 40;
const PLACEHOLDER_PEAKS: readonly number[] = new Array(BAR_COUNT).fill(0);
const SEEK_STEP_SECONDS = 0.5;

export interface VoicePlayerProps {
  kind: "message" | "reply";
  state: "idle" | "playing" | "paused";
  peaks?: readonly number[] | undefined;
  duration?: number | undefined;
  elapsed?: number | undefined;
  levels?: readonly number[] | undefined;
  onToggle: () => void;
  onSeek?: ((seconds: number) => void) | undefined;
  speed?: number | undefined;
  onCycleSpeed?: (() => void) | undefined;
}

export function VoicePlayer(props: VoicePlayerProps) {
  const { t, format } = useText();
  const speed = () => format.number(props.speed ?? 1);
  const [dragged, setDragged] = createSignal<number | null>(null);
  const active = () => props.state !== "idle";
  const duration = () => props.duration ?? 0;
  const elapsed = () => {
    const drag = dragged();
    return drag ?? props.elapsed ?? 0;
  };
  const progress = () => (duration() > 0 ? elapsed() / duration() : 0);
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
      <Show when={props.onCycleSpeed}>
        {(cycleSpeed) => (
          <Button
            variant="secondary"
            size="xs"
            type="button"
            class="voice-player-speed"
            aria-label={t("chat.voice.speedLabel", { speed: speed() })}
            title={t("chat.voice.speed")}
            onClick={() => cycleSpeed()()}
          >
            {t("chat.voice.speedValue", { speed: speed() })}
          </Button>
        )}
      </Show>
    </div>
  );
}
