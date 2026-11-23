import { Mic, Square } from "@openbot/ui";
import { createSignal, For, onSettled } from "solid-js";

const WAVE_BAR = 3;
const WAVE_PITCH = 5;
const WAVE_HEIGHT = 22;
const WAVE_SAMPLE_MS = 70;
const WAVE_SAMPLES = 120;
const WAVE_FADE_BARS = 6;

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
