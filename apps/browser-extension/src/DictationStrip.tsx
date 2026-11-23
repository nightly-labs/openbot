import { Mic, Square } from "@openbot/ui";
import { createSignal, For, onSettled } from "solid-js";

// The phone app's dictation (`apps/mobile/src/features/chat/components/composer-dictation.tsx`), drawn
// for the panel: the microphone that turns into Stop, and the strip of the recording dot, the time
// and the wave of the user's speech.

/** One bar of the wave, the space after it, and the box it moves in. */
const WAVE_BAR = 3;
const WAVE_PITCH = 5;
const WAVE_HEIGHT = 22;
/** The wave takes one sample of the voice each this many milliseconds, and moves one bar left. */
const WAVE_SAMPLE_MS = 70;
/** The samples kept: more than the widest strip has bars. */
const WAVE_SAMPLES = 120;
/** The first bars on the left fade in over this many bars, so the oldest speech leaves softly. */
const WAVE_FADE_BARS = 6;

/**
 * The mic beside Send. A tap starts dictation; while it records, the mic turns into Stop, and a tap
 * stops it and keeps the words.
 */
export function DictationMic(props: { active: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      class="ch-mic"
      data-active={props.active ? "" : undefined}
      disabled={props.disabled}
      aria-label={props.label}
      aria-pressed={props.active ? "true" : "false"}
      onClick={() => props.onPress()}
    >
      <Mic size={17} stroke-width={1.8} class="ch-mic-glyph" aria-hidden="true" />
      <Square size={12} stroke-width={2} class="ch-mic-stop" aria-hidden="true" />
    </button>
  );
}

/**
 * A wave of the user's speech: each bar is the loudest moment of a short slice of time, the newest
 * comes in at the right, and the wave glides left as the user speaks.
 */
function DictationWave(props: { level: () => number }) {
  let box: HTMLDivElement | undefined;
  let row: HTMLDivElement | undefined;
  const [count, setCount] = createSignal(0);
  const [samples, setSamples] = createSignal<number[]>(new Array(WAVE_SAMPLES).fill(0));
  onSettled(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const measure = () => setCount(Math.floor((box?.clientWidth ?? 0) / WAVE_PITCH));
    measure();
    const resize = new ResizeObserver(measure);
    if (box) resize.observe(box);
    let peak = 0;
    let elapsed = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      peak = Math.max(peak, props.level());
      elapsed += now - last;
      last = now;
      if (elapsed >= WAVE_SAMPLE_MS) {
        const loudest = peak;
        setSamples((list) => [...list.slice(1), loudest]);
        peak = 0;
        elapsed %= WAVE_SAMPLE_MS;
      }
      if (row) row.style.transform = reduced ? "" : `translateX(${(-WAVE_PITCH * elapsed) / WAVE_SAMPLE_MS}px)`;
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  });
  // One bar more than fits: it comes in from under the right edge while the wave glides.
  const bars = () => Math.min(WAVE_SAMPLES, count() + 1);
  const slots = () => Array.from({ length: bars() }, (_, index) => index);
  return (
    <div class="ch-wave" ref={box} aria-hidden="true">
      <div class="ch-wave-row" ref={row}>
        <For each={slots()}>
          {(index) => (
            <span class="ch-wave-slot" style={{ opacity: Math.min(1, (index + 1) / WAVE_FADE_BARS) }}>
              <span
                class="ch-wave-bar"
                style={{
                  height: `${WAVE_BAR + (WAVE_HEIGHT - WAVE_BAR) * Math.min(1, (samples()[WAVE_SAMPLES - bars() + index] ?? 0) * 1.4)}px`,
                }}
              />
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

/** The row in place of the draft while the user speaks: the recording dot, the time, and the wave. */
export function DictationStrip(props: { level: () => number; seconds: number }) {
  return (
    <div class="ch-strip" role="status">
      <span class="ch-strip-lead">
        <i class="ch-strip-dot" aria-hidden="true" />
        <span class="ch-strip-time">
          {`${Math.floor(props.seconds / 60)}:${String(props.seconds % 60).padStart(2, "0")}`}
        </span>
      </span>
      <DictationWave level={props.level} />
    </div>
  );
}
