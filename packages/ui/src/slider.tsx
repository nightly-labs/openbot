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
      step={props.step}
      disabled={props.disabled}
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
      <SliderPrimitive.Track class="ui-slider-track">
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
