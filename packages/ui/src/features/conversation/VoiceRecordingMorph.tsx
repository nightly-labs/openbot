import { Button, Check, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

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
  return (
    <div class="voice-morph" data-recording={props.recording ? "" : undefined}>
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
          <fieldset class="voice-recording-status" aria-label={t("composer.voice.recording")}>
            <VoiceWaveform levels={props.levels} />
            <time class="sr-only" datetime={`PT${props.elapsedSeconds}S`}>
              {formatVoiceDuration(props.elapsedSeconds)}
            </time>
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
 * Each new level enters on the right and pushes the others one dot to the left. The dots keep their
 * places, so the track is moved back by one step and slides home over the time until the next level:
 * the waveform scrolls instead of jumping.
 */
function VoiceWaveform(props: { levels: readonly number[] }): JSX.Element {
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
    <span class="voice-waveform" aria-hidden="true">
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
