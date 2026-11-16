import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, IconButton } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, onSettled, Show, untrack } from "solid-js";
import { useText } from "../text";
import { cx } from "../utils";

export type ScrollEdgesAxis = "x" | "y";

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
  label: string;
  /** The class of the frame around the scroll area. */
  class?: string;
  /** The class of the scroll area. */
  viewClass?: string;
  children: JSX.Element;
}) {
  const { t } = useText();
  const horizontal = untrack(() => props.axis) === "x";
  let view: HTMLElement | undefined;
  const [state, setState] = createStore({ start: false, end: false, rtl: false, short: false, middle: 0 });

  /** The offset of the scroll area: in a right-to-left area it counts down from zero. */
  const measureEdges = (element: HTMLElement) => {
    const offset = Math.abs(horizontal ? element.scrollLeft : element.scrollTop);
    const range = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    const rtl = horizontal && getComputedStyle(element).direction === "rtl";
    const short = (horizontal ? element.clientHeight : element.clientWidth) < SHORT_AREA;
    setState((draft) => {
      draft.start = offset > EDGE_EPSILON;
      draft.end = offset < range - EDGE_EPSILON;
      draft.rtl = rtl;
      draft.short = short;
    });
  };

  onSettled(() => {
    const element = view;
    if (!element) return;
    const measure = () => measureEdges(element);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  });

  // The arrows show only while the pointer is on the area, so the middle is measured only then.
  let followMiddle: (() => void) | undefined;
  const measureMiddle = () => {
    const element = view;
    if (!element || !horizontal) return;
    const middle = visibleMiddle(element);
    setState((draft) => {
      draft.middle = middle;
    });
  };
  const startFollowing = () => {
    measureMiddle();
    if (followMiddle) return;
    followMiddle = measureMiddle;
    document.addEventListener("scroll", followMiddle, { capture: true, passive: true });
  };
  const stopFollowing = () => {
    if (!followMiddle) return;
    document.removeEventListener("scroll", followMiddle, { capture: true });
    followMiddle = undefined;
  };
  onCleanup(stopFollowing);

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
      style={horizontal ? { "--scroll-edges-middle": `${state.middle}px` } : undefined}
      onPointerEnter={startFollowing}
      onPointerLeave={stopFollowing}
      onFocusIn={measureMiddle}
    >
      <section
        class={cx("scroll-edges-view", props.viewClass)}
        aria-label={props.label}
        tabindex="0"
        ref={(element) => (view = element)}
      >
        {props.children}
      </section>
      {edge(-1)}
      {edge(1)}
    </div>
  );
}

/** The middle of the part of the element that is in view, measured from the element's top. */
function visibleMiddle(element: HTMLElement): number {
  const box = element.getBoundingClientRect();
  if (box.height <= ARROW_HALF * 2) return box.height / 2;
  let top = Math.max(box.top, 0);
  let bottom = Math.min(box.bottom, window.innerHeight);
  // The chat scrolls the table up and down, so its own box cuts the visible part too.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "visible") continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const middle = bottom > top ? (top + bottom) / 2 - box.top : box.height / 2;
  return Math.min(Math.max(middle, ARROW_HALF), box.height - ARROW_HALF);
}
