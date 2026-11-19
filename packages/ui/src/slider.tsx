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
  formatValue: (value: number) => string;
  onChange?: (value: number) => void;
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

export function SliderField(props: SliderFieldProps): JSX.Element {
  const percent = () => ((props.value - props.minValue) / (props.maxValue - props.minValue)) * 100;
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
      <SliderPrimitive.Track
        class="ui-slider-track"
        data-cuelume-select={props.disabled ? undefined : ""}
        data-cuelume-emphasis="subtle"
      >
        <SliderPrimitive.Fill class="ui-slider-fill" />
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
  label: string;
  value: number;
  maxValue: number;
  step?: number;
  disabled?: boolean;
  formatValue: (value: number) => string;
  onChange?: (value: number) => void;
  onChangeEnd: (value: number) => void;
  class?: string;
  children?: JSX.Element;
}

export function SeekSlider(props: SeekSliderProps): JSX.Element {
  const percent = () => (props.maxValue > 0 ? (props.value / props.maxValue) * 100 : 0);
  let userChange = false;
  let lastValue = props.value;
  const startUserChange = () => {
    userChange = true;
    lastValue = props.value;
  };
  const startPointerChange = () => {
    startUserChange();
    document.addEventListener("pointerup", () => endChange(lastValue), { once: true });
  };
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
