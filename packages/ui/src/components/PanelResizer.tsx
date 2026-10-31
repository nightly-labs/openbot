import { isFunction } from "@openbot/contracts/runtime-values";
import { onSettled } from "solid-js";
import { useText } from "../text";
import { createPointerDrag } from "./createPointerDrag";

interface PanelResizerProps {
  label: string;
  controls: string;
  direction: "left" | "right";
  value: number;
  defaultValue: number;
  min: number;
  max: number | (() => number);
  onResize: (value: number) => void;
  onResizeEnd: (value: number) => void;
  onParentResize?: () => void;
  onReset?: () => void;
  snap?: {
    compactValue: number;
    compact: boolean;
    collapseThreshold: number;
    expandThreshold: number;
    onCompactChange: (compact: boolean) => void;
  };
  class?: string;
}

export function PanelResizer(props: PanelResizerProps) {
  const { t } = useText();
  let handle: HTMLHRElement | undefined;
  let parentResizeObserver: ResizeObserver | undefined;

  const maximum = () => Math.max(props.min, isFunction(props.max) ? props.max() : props.max);
  const clamp = (value: number) => Math.round(Math.min(maximum(), Math.max(props.min, value)));
  const displayedValue = () => (props.snap?.compact ? props.snap.compactValue : props.value);
  const resolve = (value: number) => {
    const snap = props.snap;
    if (!snap) return { compact: false, value: clamp(value) };
    if (snap.compact) {
      return value < snap.expandThreshold
        ? { compact: true, value: snap.compactValue }
        : { compact: false, value: clamp(Math.max(props.min, value)) };
    }
    return value < snap.collapseThreshold
      ? { compact: true, value: snap.compactValue }
      : { compact: false, value: clamp(value) };
  };
  const resize = (value: number) => {
    const next = resolve(value);
    if (props.snap && next.compact !== props.snap.compact) {
      props.snap.onCompactChange(next.compact);
    }
    if (!next.compact) props.onResize(next.value);
    return next;
  };
  const commit = (value: number) => {
    const next = resize(value);
    if (!next.compact) props.onResizeEnd(next.value);
  };
  const withoutTransition = (action: () => void) => {
    document.documentElement.classList.add("panel-resizing");
    action();
    requestAnimationFrame(() => document.documentElement.classList.remove("panel-resizing"));
  };

  const enforceBounds = () => {
    if (props.onParentResize) {
      props.onParentResize();
      return;
    }
    const next = clamp(props.value);
    if (next !== props.value) commit(next);
  };

  onSettled(() => {
    window.addEventListener("resize", enforceBounds);
    const resizeTarget = props.onParentResize ? handle?.parentElement?.parentElement : handle?.parentElement;
    if (resizeTarget) {
      parentResizeObserver = new ResizeObserver(enforceBounds);
      // Observe outer size only: inner padding changes must not reset a drag.
      parentResizeObserver.observe(resizeTarget, { box: "border-box" });
    }
    return () => {
      drag.cancel();
      parentResizeObserver?.disconnect();
      window.removeEventListener("resize", enforceBounds);
    };
  });

  let dragStartValue = 0;
  const fromDelta = (delta: number) => dragStartValue + (props.direction === "left" ? delta : -delta);
  const drag = createPointerDrag({
    axis: "x",
    rootClass: "panel-resizing",
    onStart: () => {
      dragStartValue = displayedValue();
    },
    onMove: (delta) => resize(fromDelta(delta)),
    onEnd: (delta) => commit(fromDelta(delta)),
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    let next: number | undefined;
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      withoutTransition(() => {
        props.snap?.onCompactChange(true);
        if (!props.snap) commit(props.min);
      });
      return;
    } else if (event.key === "End") next = maximum();
    else if (event.key === "ArrowRight" && props.snap?.compact) next = props.min;
    else if (event.key === "ArrowLeft" && props.snap && props.value <= props.min) {
      event.preventDefault();
      event.stopPropagation();
      withoutTransition(() => props.snap?.onCompactChange(true));
      return;
    } else if (event.key === "ArrowLeft") next = props.value + (props.direction === "right" ? 12 : -12);
    else if (event.key === "ArrowRight") next = props.value + (props.direction === "left" ? 12 : -12);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    withoutTransition(() => commit(next));
  };

  return (
    <hr
      ref={(element) => (handle = element)}
      class={`panel-resizer no-drag ${drag.isDragging() ? "panel-resizer-active" : ""} ${props.class ?? ""}`}
      tabindex={0}
      aria-label={props.label}
      aria-controls={props.controls}
      aria-orientation="vertical"
      aria-valuemin={props.snap?.compactValue ?? props.min}
      aria-valuemax={maximum()}
      aria-valuenow={displayedValue()}
      aria-valuetext={
        props.snap?.compact ? t("sidebar.resizer.compactWidth", { width: props.snap.compactValue }) : `${props.value}px`
      }
      onPointerDown={drag.begin}
      onKeyDown={handleKeyDown}
      onDblClick={(event) => {
        event.preventDefault();
        if (props.onReset) props.onReset();
        else commit(props.defaultValue);
      }}
    />
  );
}
