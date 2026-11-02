import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, LoaderCircle, Mic, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

export type VoicePhase = "idle" | "preparing" | "requesting" | "recording" | "transcribing";

/** The bar counts down the time left in this many last seconds of a recording. */
export const VOICE_LIMIT_COUNTDOWN_SECONDS = 15;
/** This many seconds before the limit, the countdown turns orange and a warning plays. */
export const VOICE_LIMIT_WARNING_SECONDS = 10;

/** The catalog key of the voice button's accessible name. */
export function voiceButtonLabel(phase: VoicePhase): AppTextKey {
  if (phase === "recording") return "composer.voice.stop";
  if (phase === "preparing") return "composer.voice.preparing";
  if (phase === "requesting") return "composer.voice.requesting";
  if (phase === "transcribing") return "composer.voice.transcribing";
  return "composer.voice.start";
}

function formatVoiceDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * The microphone and send controls, which melt into a recording bar while you speak: the
 * microphone stretches into a waveform with Cancel, and Finish buds off the send button.
 *
 * The shapes under the controls go through one SVG "goo" filter (blur, then a hard alpha
 * threshold), so two shapes that come close join with a liquid neck instead of overlapping.
 * The controls themselves are drawn on top without the filter, so their icons stay sharp.
 */
export function VoiceRecordingMorph(props: {
  recording: boolean;
  /** Microphone loudness, 0 to 1, oldest first. */
  levels: readonly number[];
  elapsedSeconds: number;
  onCancel: () => void;
  onFinish: () => void;
  /** The microphone control, shown when not recording. */
  children: JSX.Element;
  /** The send control. Finish buds off it. */
  send: JSX.Element;
}): JSX.Element {
  const { t } = useText();
  const filterId = `voice-morph-goo-${createUniqueId()}`;
  const remainingSeconds = () => Math.max(0, VOICE_AUDIO_LIMITS.maximumSeconds - props.elapsedSeconds);
  const countingDown = () => remainingSeconds() <= VOICE_LIMIT_COUNTDOWN_SECONDS;
  const warning = () => remainingSeconds() <= VOICE_LIMIT_WARNING_SECONDS;
  return (
    <div
      class="voice-morph"
      data-recording={props.recording ? "" : undefined}
      data-countdown={props.recording && countingDown() ? "" : undefined}
    >
      <svg class="voice-morph-filter" aria-hidden="true">
        <filter id={filterId} color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </svg>
      <span class="voice-morph-goo voice-morph-goo-bar" style={{ filter: `url(#${filterId})` }} aria-hidden="true">
        <span class="voice-morph-bar" />
      </span>
      <span class="voice-morph-goo voice-morph-goo-light" style={{ filter: `url(#${filterId})` }} aria-hidden="true">
        <span class="voice-morph-send-blob" />
        <span class="voice-morph-finish-blob" />
      </span>
      <div class="voice-morph-slot">
        <Show when={props.recording} fallback={props.children}>
          <fieldset
            class="voice-recording-status"
            data-tone={warning() ? "warning" : undefined}
            aria-label={t("composer.voice.recording")}
          >
            <VoiceWaveform levels={props.levels} />
            <time class="sr-only" datetime={`PT${props.elapsedSeconds}S`}>
              {formatVoiceDuration(props.elapsedSeconds)}
            </time>
            <Show when={countingDown()}>
              <span class="voice-recording-remaining" aria-hidden="true">
                {formatVoiceDuration(remainingSeconds())}
              </span>
            </Show>
            {/* Present from the start, so screen readers announce the text when it appears. */}
            <span class="sr-only" role="status">
              {warning() ? t("composer.voice.limitSoon", { seconds: VOICE_LIMIT_WARNING_SECONDS }) : ""}
            </span>
            <Button
              variant="ghost"
              type="button"
              class="voice-recording-cancel"
              aria-label={t("composer.voice.cancel")}
              onClick={() => props.onCancel()}
            >
              <X aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              type="button"
              class="voice-recording-finish"
              aria-label={t("composer.voice.stop")}
              onClick={() => props.onFinish()}
            >
              <Check aria-hidden="true" />
            </Button>
          </fieldset>
        </Show>
      </div>
      <span class="voice-morph-send">{props.send}</span>
    </div>
  );
}

/**
 * The dictation controls of a message box: the speech model progress while it is prepared, then the
 * microphone and the send control in one recording morph. The main chat and side threads share them.
 */
export function ComposerVoiceControls(props: {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  /** The microphone cannot start a recording now. It is always disabled outside the idle phase. */
  blocked: boolean;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** The send control. Finish buds off it. */
  send: JSX.Element;
}): JSX.Element {
  const { t } = useText();
  return (
    <>
      <Show when={props.phase === "preparing"}>
        <span class="voice-model-progress" role="status">
          {t("composer.voice.progress", { progress: props.modelProgress ?? 0 })}
        </span>
      </Show>
      <VoiceRecordingMorph
        recording={props.phase === "recording"}
        levels={props.levels}
        elapsedSeconds={props.elapsedSeconds}
        onCancel={() => props.onCancel()}
        onFinish={() => props.onFinish()}
        send={props.send}
      >
        <Button
          variant="ghost"
          type="button"
          class="dictation-button"
          aria-label={t(voiceButtonLabel(props.phase))}
          disabled={props.blocked || props.phase !== "idle"}
          onClick={() => props.onStart()}
        >
          <Show when={props.phase !== "idle"} fallback={<Mic aria-hidden="true" />}>
            <LoaderCircle class="composer-spinner" aria-hidden="true" />
          </Show>
        </Button>
      </VoiceRecordingMorph>
    </>
  );
}

/**
 * Each new level enters on the right and pushes the others one dot to the left. The dots keep their
 * places, so the track is moved back by one step and slides home over the time until the next level:
 * the waveform scrolls instead of jumping.
 */
export function VoiceWaveform(props: { levels: readonly number[]; class?: string }): JSX.Element {
  let track: HTMLSpanElement | undefined;
  let lastUpdate = 0;
  createEffect(
    () => props.levels,
    () => {
      const now = performance.now();
      const interval = now - lastUpdate;
      lastUpdate = now;
      const [first, second] = track?.children ?? [];
      if (!track || !(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return;
      if (interval > 500 || prefersReducedMotion()) return;
      const step = second.offsetLeft - first.offsetLeft;
      track.animate([{ transform: `translateX(${step}px)` }, { transform: "none" }], { duration: interval });
    },
  );
  return (
    <span class={["voice-waveform", props.class]} aria-hidden="true">
      <span
        ref={(element) => {
          track = element;
        }}
        class="voice-waveform-track"
      >
        <For each={props.levels} keyed={false}>
          {(level) => <span class="voice-waveform-dot" style={{ "--voice-level": String(level()) }} />}
        </For>
      </span>
    </span>
  );
}
