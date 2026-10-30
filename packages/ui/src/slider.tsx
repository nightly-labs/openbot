import * as SliderPrimitive from "@kobalte/core/slider";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { cx } from "./utils";

export interface SliderFieldProps {
  label: JSX.Element;
  description?: JSX.Element;
  value: number;
  minValue: number;
  maxValue: number;
  step?: number;
  disabled?: boolean;
  /** The text shown beside the label and read by screen readers for the current value. */
  formatValue: (value: number) => string;
  /** Runs on each step while the user drags or presses a key. */
  onChange?: (value: number) => void;
  /** Runs once when the user releases the thumb, so a caller can save the final value only. */
  onChangeEnd?: (value: number) => void;
  class?: string;
}

const SLIDER_STEP_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** One labelled value on a track, with the current value shown beside the label. */
export function SliderField(props: SliderFieldProps): JSX.Element {
  const percent = () => ((props.value - props.minValue) / (props.maxValue - props.minValue)) * 100;
  // On each thumb move, Kobalte reports the new value and then its own value again. Solid has not
  // applied the write yet, so the second report is the old value and would undo the drag. The first
  // report of a task is the real one.
  let reportedThisTask = false;
  function reportChange(value: number): void {
    if (reportedThisTask) return;
    reportedThisTask = true;
    queueMicrotask(() => {
      reportedThisTask = false;
    });
    props.onChange?.(value);
  }
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      class={cx("ui-slider-field", props.class)}
      value={[props.value]}
      minValue={props.minValue}
      maxValue={props.maxValue}
      step={props.step ?? 1}
      disabled={props.disabled ?? false}
      getValueLabel={(params) => props.formatValue(params.values[0] ?? props.value)}
      onChange={(values) => reportChange(values[0] ?? props.value)}
      onChangeEnd={(values) => props.onChangeEnd?.(values[0] ?? props.value)}
    >
      <div class="ui-slider-header">
        <SliderPrimitive.Label class="ui-slider-label">{props.label}</SliderPrimitive.Label>
        <SliderPrimitive.ValueLabel class="ui-slider-value" />
      </div>
      <Show when={props.description}>
        <SliderPrimitive.Description class="ui-slider-description">{props.description}</SliderPrimitive.Description>
      </Show>
      {/* The track keeps the pointer during a drag, so the cue plays once, when the user releases it. */}
      <SliderPrimitive.Track
        class="ui-slider-track"
        data-cuelume-select={props.disabled ? undefined : ""}
        data-cuelume-emphasis="subtle"
      >
        <SliderPrimitive.Fill class="ui-slider-fill" />
        {/* Kobalte renders `calc(NaN%)` until the thumb registers, so the wrapper sets the position.
            Its thumb value text ignores getValueLabel, so the wrapper sets that too,
            and aria-disabled, which Kobalte leaves off.
            Kobalte also ends a keyboard change only on blur, so a key release ends it here. There is no
            Slider.Input: nothing submits a form, and a second slider role would repeat the control. */}
        <SliderPrimitive.Thumb
          class="ui-slider-thumb"
          style={{ left: `${percent()}%` }}
          aria-valuetext={props.formatValue(props.value)}
          aria-disabled={props.disabled ? "true" : undefined}
          onKeyUp={(event) => {
            if (SLIDER_STEP_KEYS.has(event.key)) props.onChangeEnd?.(props.value);
          }}
        />
      </SliderPrimitive.Track>
    </SliderPrimitive.Root>
  );
}

export interface SeekSliderProps {
  /** The name screen readers announce for the position, such as "Playback position". */
  label: string;
  value: number;
  maxValue: number;
  step?: number;
  disabled?: boolean;
  formatValue: (value: number) => string;
  /** Runs while the user drags or presses a key, before the position is final. */
  onChange?: (value: number) => void;
  /** Runs once when the user releases the pointer or the key. */
  onChangeEnd: (value: number) => void;
  class?: string;
  /** Drawn on the track under the playhead, such as the waveform of a recording. */
  children?: JSX.Element;
}

/** A playback position over a picture of the media: click, drag or use the keys to move it. */
export function SeekSlider(props: SeekSliderProps): JSX.Element {
  const percent = () => (props.maxValue > 0 ? (props.value / props.maxValue) * 100 : 0);
  // Kobalte also reports a change when the value prop moves on its own, as it does while media
  // plays. Only a change the user started is passed on, until the user releases it.
  let userChange = false;
  let lastValue = props.value;
  const startUserChange = () => {
    userChange = true;
    lastValue = props.value;
  };
  // Kobalte ends a change only for a thumb drag, so a press on the picture ends where it is released.
  const startPointerChange = () => {
    startUserChange();
    document.addEventListener("pointerup", () => endChange(lastValue), { once: true });
  };
  // The same double report as in SliderField: the first report of a task is the real one.
  let reportedThisTask = false;
  function reportChange(value: number): void {
    if (!userChange || reportedThisTask) return;
    lastValue = value;
    reportedThisTask = true;
    queueMicrotask(() => {
      reportedThisTask = false;
    });
    props.onChange?.(value);
  }
  function endChange(value: number): void {
    if (!userChange) return;
    userChange = false;
    props.onChangeEnd(value);
  }
  return (
    <SliderPrimitive.Root
      data-slot="seek-slider"
      class={cx("ui-seek-slider", props.class)}
      value={[props.value]}
      minValue={0}
      maxValue={Math.max(props.maxValue, 0)}
      step={props.step ?? 1}
      disabled={props.disabled ?? false}
      getValueLabel={(params) => props.formatValue(params.values[0] ?? props.value)}
      onChange={(values) => reportChange(values[0] ?? props.value)}
      onChangeEnd={(values) => endChange(values[0] ?? props.value)}
    >
      <SliderPrimitive.Track class="ui-seek-slider-track">
        {/* A press on the picture or the thumb reaches these before the track moves the value. */}
        <span class="ui-seek-slider-picture" onPointerDown={startPointerChange}>
          {props.children}
        </span>
        <SliderPrimitive.Thumb
          class="ui-seek-slider-thumb"
          style={{ left: `${percent()}%` }}
          aria-label={props.label}
          aria-valuetext={props.formatValue(props.value)}
          aria-disabled={props.disabled ? "true" : undefined}
          onPointerDown={startPointerChange}
          onKeyDown={(event) => {
            if (SLIDER_STEP_KEYS.has(event.key)) startUserChange();
          }}
          onKeyUp={(event) => {
            if (SLIDER_STEP_KEYS.has(event.key)) endChange(props.value);
          }}
        />
      </SliderPrimitive.Track>
    </SliderPrimitive.Root>
  );
}
