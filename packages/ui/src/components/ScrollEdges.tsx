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
  /** The area scrolls on either axis: a code block also scrolls up and down. */
  scrolls: boolean;
  middle: number | null;
};

/** Slack in pixels before an edge counts as reached, for sub-pixel scroll positions. */
const EDGE_EPSILON = 1;

/** An area lower or narrower than this gets the small arrow, so the arrow does not hide the content. */
const SHORT_AREA = 56;

/** Half an arrow and its space: the middle of the arrows stays this far from each end of the area. */
const ARROW_HALF = 22;

/** One arrow click scrolls this part of the visible width or height. */
const STEP = 0.8;

/**
 * A scroll area that shows where it has more content. The edge with more content fades, and while
 * the pointer is on the area, or the area has keyboard focus, an arrow on that edge scrolls it.
 * The system scrollbar does not show. The x arrows stay at the middle of the visible part of the
 * area, so a tall table keeps them in view.
 */
export function ScrollEdges(props: {
  axis: ScrollEdgesAxis;
  /** The accessible name of the scroll area. */
  label?: string;
  /** The direction of the area, when it differs from the text around it, such as code. */
  dir?: "ltr" | "rtl";
  /** The class of the frame around the scroll area. */
  class?: string;
  /** The class of the scroll area. */
  viewClass?: string;
  children: JSX.Element;
}) {
  const { t } = useText();
  const horizontal = untrack(() => props.axis) === "x";
  let view: HTMLElement | undefined;
  // The middle is null until the first measurement, so the CSS fallback centres the arrows.
  const [state, setState] = createStore<ScrollEdgesState>({
    start: false,
    end: false,
    rtl: false,
    short: false,
    scrolls: false,
    middle: null,
  });

  /** The offset of the scroll area: in a right-to-left area it counts down from zero. */
  const measureEdges = (element: HTMLElement) => {
    const offset = Math.abs(horizontal ? element.scrollLeft : element.scrollTop);
    const range = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    const style = getComputedStyle(element);
    const rtl = horizontal && style.direction === "rtl";
    const short = (horizontal ? element.clientHeight : element.clientWidth) < SHORT_AREA;
    // The other axis counts only when it can scroll, not when it clips, as block math does.
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

  // The arrows show only while the pointer is on the area or the area has the focus, so the middle
  // is measured only then: at most once in each frame, against the ancestors that clip the area.
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
    measureEdges(element);
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

  // In a right-to-left area, the start edge is on the right.
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
        // The scroll area itself takes the keyboard focus and scrolls with the arrow keys.
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
        // Only an area that scrolls is a stop in the Tab order.
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

/** The ancestors that clip the element: the chat scrolls the table up and down, so its box cuts the visible part. */
function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY !== "visible") clips.push(parent);
  }
  return clips;
}

/** The middle of the part of the element that is in view, measured from the element's top. */
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
