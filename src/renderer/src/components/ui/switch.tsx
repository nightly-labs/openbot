import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SwitchPrimitive from "@kobalte/core/switch";
import type { ComponentProps, JSX, ValidComponent } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, omit, onCleanup, Show, untrack } from "solid-js";
import { cx } from "./utils";

export type SwitchSize = "sm" | "default";

type SwitchAccessibilityProps = {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

type OpenBotSwitchProps = SwitchAccessibilityProps & {
  class?: JSX.HTMLAttributes<HTMLElement>["class"];
  size?: SwitchSize;
};

export type SwitchProps<T extends ValidComponent = "div"> = PolymorphicProps<T, SwitchPrimitive.SwitchRootProps<T>> &
  OpenBotSwitchProps &
  Partial<Pick<ComponentProps<T>, "class">>;

const SWITCH_DRAG_THRESHOLD_PX = 3;

type SwitchMotionControlProps = {
  setPointerFocus: (pointerFocus: boolean) => void;
};

type SwitchMotionThumbProps = {
  checked: () => boolean;
  dragProgress: () => number | undefined;
};

function SwitchMotionThumb(props: SwitchMotionThumbProps): JSX.Element {
  let thumb: HTMLDivElement | undefined;
  let position = untrack(props.checked) ? 1 : 0;
  let target = position;
  let velocity = 0;
  let frame: number | undefined;
  let lastTimestamp: number | undefined;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function paint(): void {
    if (!thumb) return;
    const stretch = Math.min(0.24, Math.abs(velocity) * 0.035);
    thumb.style.setProperty("--ui-switch-position", String(position));
    thumb.style.setProperty("--ui-switch-scale-x", String(1 + stretch));
    thumb.style.setProperty("--ui-switch-scale-y", String(1 - stretch * 0.55));
  }

  function stopAnimation(): void {
    if (frame === undefined) return;
    window.cancelAnimationFrame(frame);
    frame = undefined;
    lastTimestamp = undefined;
  }

  function step(timestamp: number): void {
    frame = undefined;
    const previousTimestamp = lastTimestamp ?? timestamp;
    lastTimestamp = timestamp;
    const delta = Math.min((timestamp - previousTimestamp) / 1_000, 0.032);
    velocity += (target - position) * 520 * delta;
    velocity *= Math.exp(-32 * delta);
    position += velocity * delta;

    const settled = Math.abs(target - position) < 0.001 && Math.abs(velocity) < 0.001;
    if (settled) {
      position = target;
      velocity = 0;
    }
    paint();
    if (!settled) frame = window.requestAnimationFrame(step);
    else lastTimestamp = undefined;
  }

  function scheduleAnimation(): void {
    if (frame !== undefined || !thumb) return;
    if (reducedMotion || typeof window.requestAnimationFrame !== "function") {
      position = target;
      velocity = 0;
      paint();
      return;
    }
    frame = window.requestAnimationFrame(step);
  }

  createEffect(
    () => ({ dragPosition: props.dragProgress(), checked: props.checked() }),
    ({ dragPosition, checked }) => {
      if (dragPosition !== undefined) {
        stopAnimation();
        position = dragPosition;
        target = dragPosition;
        velocity = 0;
        paint();
        return;
      }

      target = checked ? 1 : 0;
      scheduleAnimation();
    },
  );

  onCleanup(stopAnimation);

  return (
    <SwitchPrimitive.Thumb
      ref={(element) => {
        thumb = element;
        paint();
      }}
      data-slot="switch-thumb"
      class="ui-switch-thumb"
    />
  );
}

function SwitchMotionControl(props: SwitchMotionControlProps): JSX.Element {
  const context = SwitchPrimitive.useSwitchContext();
  const [dragProgress, setDragProgress] = createSignal<number | undefined>();
  const [dragging, setDragging] = createSignal(false);
  const [controlElement, setControlElement] = createSignal<HTMLDivElement>();
  let control: HTMLDivElement | undefined;
  let drag:
    | {
        pointerId: number;
        grab: number;
        startProgress: number;
        startClientX: number;
        progress: number;
        moved: boolean;
      }
    | undefined;
  let suppressClick = false;

  function metrics(): { left: number; inset: number; travel: number } | undefined {
    if (!control) return undefined;
    const rect = control.getBoundingClientRect();
    const styles = window.getComputedStyle(control);
    const inset = Number.parseFloat(styles.getPropertyValue("--ui-switch-inset")) || 0;
    const thumb = control.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
    const thumbWidth = thumb
      ? thumb.offsetWidth || Number.parseFloat(window.getComputedStyle(thumb).width)
      : rect.height;
    const travel = Math.max(1, rect.width - (thumbWidth || rect.height) - inset * 2);
    return { left: rect.left, inset, travel };
  }

  function finishPointer(event: PointerEvent, cancelled = false): void {
    const activeDrag = drag;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    if (!cancelled) updateDrag(event);
    if (!cancelled && activeDrag.moved) context.setIsChecked(activeDrag.progress >= 0.5);
    drag = undefined;
    setDragging(false);
    suppressClick = !cancelled && activeDrag.moved;
    setDragProgress(undefined);

    if (control?.hasPointerCapture?.(event.pointerId)) control.releasePointerCapture?.(event.pointerId);
  }

  function updateDrag(event: PointerEvent): void {
    const activeDrag = drag;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const switchMetrics = metrics();
    if (!switchMetrics) return;
    const nextProgress = Math.min(
      1,
      Math.max(0, (event.clientX - switchMetrics.left - switchMetrics.inset - activeDrag.grab) / switchMetrics.travel),
    );
    if (Math.abs(event.clientX - activeDrag.startClientX) >= SWITCH_DRAG_THRESHOLD_PX) activeDrag.moved = true;
    activeDrag.progress = nextProgress;
    setDragProgress(nextProgress);
  }

  function suppressDraggedClick(event: MouseEvent): void {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  createEffect(
    () => controlElement(),
    (element) => {
      if (!element) return;
      element.addEventListener("click", suppressDraggedClick, true);
      onCleanup(() => element.removeEventListener("click", suppressDraggedClick, true));
    },
  );

  return (
    <SwitchPrimitive.Control
      ref={(element) => {
        control = element;
        setControlElement(element);
      }}
      data-slot="switch-control"
      data-dragging={dragging() ? "" : undefined}
      class="ui-switch-control"
      onPointerDown={(event) => {
        suppressClick = false;
        if (event.button !== 0) return;
        props.setPointerFocus(true);
        event.preventDefault();
        if (context.inputRef()?.disabled || context.inputRef()?.readOnly) return;

        const switchMetrics = metrics();
        if (!switchMetrics) return;
        const startProgress = context.checked() ? 1 : 0;
        const thumbStart = switchMetrics.left + switchMetrics.inset + startProgress * switchMetrics.travel;
        drag = {
          pointerId: event.pointerId,
          grab: event.clientX - thumbStart,
          startProgress,
          startClientX: event.clientX,
          progress: startProgress,
          moved: false,
        };
        setDragging(true);
        setDragProgress(startProgress);
        control?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        updateDrag(event);
      }}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={(event) => finishPointer(event, true)}
      onClick={(event) => event.preventDefault()}
    >
      <SwitchMotionThumb checked={context.checked} dragProgress={dragProgress} />
    </SwitchPrimitive.Control>
  );
}

export function Switch<T extends ValidComponent = "div">(props: SwitchProps<T>): JSX.Element {
  const [pointerFocus, setPointerFocus] = createSignal(false);
  const others = omit(props, "class", "size", "id", "aria-label", "aria-labelledby", "aria-describedby", "children");
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Solid 2's omit cannot preserve Kobalte's generic polymorphic props.
  const rootProps = others as PolymorphicProps<T, SwitchPrimitive.SwitchRootProps<T>>;

  return (
    <SwitchPrimitive.Root<T>
      data-slot="switch"
      data-size={props.size ?? "default"}
      data-pointer-focus={pointerFocus() ? "" : undefined}
      class={cx("ui-switch", props.class)}
      {...rootProps}
    >
      <SwitchPrimitive.Input
        id={props.id}
        data-slot="switch-input"
        class="ui-switch-input"
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        onKeyDown={() => setPointerFocus(false)}
        onBlur={() => setPointerFocus(false)}
      />
      <SwitchMotionControl setPointerFocus={setPointerFocus} />
    </SwitchPrimitive.Root>
  );
}

export interface SwitchFieldProps extends Omit<SwitchProps<"div">, "aria-label" | "children" | "class" | "id"> {
  class?: string;
  switchClass?: string;
  id?: string;
  label: JSX.Element;
  description?: JSX.Element;
}

export function SwitchField(props: SwitchFieldProps): JSX.Element {
  const generatedId = `switch-field-${createUniqueId()}`;
  const switchId = () => props.id ?? generatedId;
  const descriptionId = () => `${switchId()}-description`;
  const others = omit(props, "class", "switchClass", "id", "label", "description");

  return (
    <div class={cx("ui-switch-field", props.class)}>
      <span class="ui-switch-copy">
        <label class="ui-switch-label" for={switchId()} onPointerDown={(event) => event.preventDefault()}>
          {props.label}
        </label>
        <Show when={props.description}>
          <span id={descriptionId()} class="ui-switch-description">
            {props.description}
          </span>
        </Show>
      </span>
      <Switch
        id={switchId()}
        class={props.switchClass}
        aria-describedby={props.description ? descriptionId() : undefined}
        {...others}
      />
    </div>
  );
}
