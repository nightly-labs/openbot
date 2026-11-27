import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, LoaderCircle, Mic, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

export type VoicePhase = "idle" | "preparing" | "requesting" | "recording" | "transcribing";

export const VOICE_LIMIT_COUNTDOWN_SECONDS = 15;
export const VOICE_LIMIT_WARNING_SECONDS = 10;

export function voiceButtonLabel(phase: VoicePhase, modelProgress: number | null): AppTextKey {
  if (phase === "recording") return "composer.voice.stop";
  if (phase === "preparing") return modelProgress === null ? "composer.voice.starting" : "composer.voice.preparing";
  if (phase === "requesting") return "composer.voice.requesting";
  if (phase === "transcribing") return "composer.voice.transcribing";
  return "composer.voice.start";
}

function enterSendsRecording(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
  return event.target === document.body || event.target === document.documentElement;
}

function formatVoiceDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function voiceLimit(elapsedSeconds: () => number) {
  const remainingSeconds = () => Math.max(0, VOICE_AUDIO_LIMITS.maximumSeconds - elapsedSeconds());
  return {
    remainingSeconds,
    countingDown: () => remainingSeconds() <= VOICE_LIMIT_COUNTDOWN_SECONDS,
    warning: () => remainingSeconds() <= VOICE_LIMIT_WARNING_SECONDS,
  };
}

function VoiceLimitNotice(props: { limit: ReturnType<typeof voiceLimit> }): JSX.Element {
  const { t } = useText();
  return (
    <>
      <Show when={props.limit.countingDown()}>
        <span class="voice-recording-remaining" aria-hidden="true">
          {formatVoiceDuration(props.limit.remainingSeconds())}
        </span>
      </Show>
      <span class="sr-only" role="status">
        {props.limit.warning() ? t("composer.voice.limitSoon", { seconds: VOICE_LIMIT_WARNING_SECONDS }) : ""}
      </span>
    </>
  );
}

export function VoiceRecordingMorph(props: {
  recording: boolean;
  levels: readonly number[];
  elapsedSeconds: number;
  onCancel: () => void;
  onFinish: () => void;
  onSend: () => void;
  children: JSX.Element;
  send: JSX.Element;
}): JSX.Element {
  const { t } = useText();
  const filterId = `voice-morph-goo-${createUniqueId()}`;
  const limit = voiceLimit(() => props.elapsedSeconds);
  createEffect(
    () => props.recording,
    (recording) => {
      if (!recording) return;
      const sendOnEnter = (event: KeyboardEvent) => {
        if (enterSendsRecording(event)) props.onSend();
      };
      document.addEventListener("keydown", sendOnEnter);
      return () => document.removeEventListener("keydown", sendOnEnter);
    },
  );
  return (
    <div
      class="voice-morph"
      data-recording={props.recording ? "" : undefined}
      data-countdown={props.recording && limit.countingDown() ? "" : undefined}
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
            data-tone={limit.warning() ? "warning" : undefined}
            aria-label={t("composer.voice.recording")}
          >
            <VoiceWaveform levels={props.levels} />
            <time class="sr-only" datetime={`PT${props.elapsedSeconds}S`}>
              {formatVoiceDuration(props.elapsedSeconds)}
            </time>
            <VoiceLimitNotice limit={limit} />
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

export function ComposerVoiceControls(props: {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  modelProgress: number | null;
  blocked: boolean;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  onSend: () => void;
  send: JSX.Element;
}): JSX.Element {
  const { t } = useText();
  return (
    <>
      <Show when={props.phase === "preparing" && props.modelProgress !== null}>
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
        onSend={() => props.onSend()}
        send={props.send}
      >
        <Button
          variant="ghost"
          type="button"
          class="dictation-button"
          aria-label={t(voiceButtonLabel(props.phase, props.modelProgress))}
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

export function CoveredVoiceRecording(props: {
  levels: readonly number[];
  elapsedSeconds: number;
  onCancel: () => void;
  onFinish: () => void;
}): JSX.Element {
  const { t } = useText();
  const limit = voiceLimit(() => props.elapsedSeconds);
  return (
    <section
      class="covered-voice-recording"
      data-tone={limit.warning() ? "warning" : undefined}
      aria-label={t("composer.voice.recording")}
    >
      <Mic class="covered-voice-recording-icon" aria-hidden="true" />
      <span class="covered-voice-recording-label">{t("composer.voice.recording")}</span>
      <VoiceWaveform levels={props.levels} class="covered-voice-recording-waveform" />
      <Show
        when={limit.countingDown()}
        fallback={
          <time class="covered-voice-recording-time" datetime={`PT${props.elapsedSeconds}S`}>
            {formatVoiceDuration(props.elapsedSeconds)}
          </time>
        }
      >
        <time class="sr-only" datetime={`PT${props.elapsedSeconds}S`}>
          {formatVoiceDuration(props.elapsedSeconds)}
        </time>
      </Show>
      <VoiceLimitNotice limit={limit} />
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label={t("composer.voice.cancel")}
        title={t("composer.voice.cancel")}
        onClick={() => props.onCancel()}
      >
        <X aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label={t("composer.voice.stop")}
        title={t("composer.voice.stop")}
        onClick={() => props.onFinish()}
      >
        <Check aria-hidden="true" />
      </Button>
    </section>
  );
}

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
