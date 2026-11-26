import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, IconButton } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, onSettled, Show, untrack } from "solid-js";
import { useText } from "../text";
import { cx } from "../utils";

export type ScrollEdgesAxis = "x" | "y";

type ScrollEdgesState = {
  start: boolean;
  end: boolean;
  rtl: boolean;
  short: boolean;
  scrolls: boolean;
  middle: number | null;
};

const EDGE_EPSILON = 1;

const SHORT_AREA = 56;

const ARROW_HALF = 22;

const STEP = 0.8;

export function ScrollEdges(props: {
  axis: ScrollEdgesAxis;
  label?: string;
  dir?: "ltr" | "rtl";
  class?: string;
  viewClass?: string;
  children: JSX.Element;
}) {
  const { t } = useText();
  const horizontal = untrack(() => props.axis) === "x";
  let view: HTMLElement | undefined;
  const [state, setState] = createStore<ScrollEdgesState>({
    start: false,
    end: false,
    rtl: false,
    short: false,
    scrolls: false,
    middle: null,
  });

  const measureEdges = (element: HTMLElement) => {
    const offset = Math.abs(horizontal ? element.scrollLeft : element.scrollTop);
    const range = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    const style = getComputedStyle(element);
    const rtl = horizontal && style.direction === "rtl";
    const short = (horizontal ? element.clientHeight : element.clientWidth) < SHORT_AREA;
    const crossOverflow = horizontal ? style.overflowY : style.overflowX;
    const crossRange = horizontal
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;
    const crossScrolls = (crossOverflow === "auto" || crossOverflow === "scroll") && crossRange > EDGE_EPSILON;
    setState((draft) => {
      draft.start = offset > EDGE_EPSILON;
      draft.end = offset < range - EDGE_EPSILON;
      draft.rtl = rtl;
      draft.short = short;
      draft.scrolls = range > EDGE_EPSILON || crossScrolls;
    });
  };

  let hovered = false;
  let focused = false;
  let clips: HTMLElement[] | undefined;
  let frame = 0;
  const measureMiddle = () => {
    frame = 0;
    const element = view;
    if (!element || !clips) return;
    const middle = visibleMiddle(element, clips);
    setState((draft) => {
      draft.middle = middle;
    });
  };
  const scheduleMiddle = () => {
    if (!frame && clips) frame = requestAnimationFrame(measureMiddle);
  };
  const follow = () => {
    const element = view;
    if (!horizontal || !element) return;
    if (hovered || focused) {
      if (clips) return;
      clips = clippingAncestors(element);
      document.addEventListener("scroll", scheduleMiddle, { capture: true, passive: true });
      measureMiddle();
      return;
    }
    if (!clips) return;
    document.removeEventListener("scroll", scheduleMiddle, { capture: true });
    cancelAnimationFrame(frame);
    frame = 0;
    clips = undefined;
  };
  const setHovered = (value: boolean) => {
    hovered = value;
    follow();
  };
  const setFocused = (value: boolean) => {
    focused = value;
    follow();
  };
  onCleanup(() => {
    hovered = false;
    setFocused(false);
  });

  onSettled(() => {
    const element = view;
    if (!element) return;
    const measure = () => {
      measureEdges(element);
      scheduleMiddle();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  });

  const step = (direction: 1 | -1) => {
    const element = view;
    if (!element) return;
    const distance = direction * STEP * (horizontal ? element.clientWidth : element.clientHeight);
    element.scrollBy(
      horizontal
        ? { left: (state.rtl ? -1 : 1) * distance, behavior: "smooth" }
        : { top: distance, behavior: "smooth" },
    );
  };

  const arrow = (direction: 1 | -1) => {
    const left = (direction === -1) !== state.rtl;
    if (!horizontal) return direction === -1 ? "up" : "down";
    return left ? "left" : "right";
  };

  const edge = (direction: 1 | -1) => (
    <div
      class="scroll-edges-edge"
      data-edge={direction === -1 ? "start" : "end"}
      data-visible={(direction === -1 ? state.start : state.end) ? "" : undefined}
    >
      <IconButton
        class="scroll-edges-arrow"
        variant="secondary"
        size={state.short ? "icon-xs" : "icon-sm"}
        label={
          {
            up: t("common.scrollUp"),
            down: t("common.scrollDown"),
            left: t("common.scrollLeft"),
            right: t("common.scrollRight"),
          }[arrow(direction)]
        }
        tabindex="-1"
        onClick={() => step(direction)}
      >
        <Show when={arrow(direction) === "up"}>
          <ChevronUp />
        </Show>
        <Show when={arrow(direction) === "down"}>
          <ChevronDown />
        </Show>
        <Show when={arrow(direction) === "left"}>
          <ChevronLeft />
        </Show>
        <Show when={arrow(direction) === "right"}>
          <ChevronRight />
        </Show>
      </IconButton>
    </div>
  );

  return (
    <div
      class={cx("scroll-edges", props.class)}
      data-axis={props.axis}
      data-start-visible={state.start ? "" : undefined}
      data-end-visible={state.end ? "" : undefined}
      dir={props.dir}
      style={state.middle === null ? undefined : { "--scroll-edges-middle": `${state.middle}px` }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={(event) =>
        setFocused(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      }
    >
      <section
        class={cx("scroll-edges-view", props.viewClass)}
        aria-label={props.label}
        tabindex={state.scrolls ? 0 : undefined}
        ref={(element) => (view = element)}
      >
        {props.children}
      </section>
      {edge(-1)}
      {edge(1)}
    </div>
  );
}

function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY !== "visible") clips.push(parent);
  }
  return clips;
}

function visibleMiddle(element: HTMLElement, clips: HTMLElement[]): number {
  const box = element.getBoundingClientRect();
  if (box.height <= ARROW_HALF * 2) return box.height / 2;
  let top = Math.max(box.top, 0);
  let bottom = Math.min(box.bottom, window.innerHeight);
  for (const clip of clips) {
    const rect = clip.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  const middle = bottom > top ? (top + bottom) / 2 - box.top : box.height / 2;
  return Math.min(Math.max(middle, ARROW_HALF), box.height - ARROW_HALF);
}
