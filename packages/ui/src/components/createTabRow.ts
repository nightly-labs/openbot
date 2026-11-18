import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createStore } from "solid-js";

/** A held tab this close to an end of the row scrolls the row, at up to this many pixels a frame. */
const EDGE_ZONE_PX = 40;
const EDGE_SPEED_PX = 14;

/** What a row of tabs shows besides the tabs: the tabs out of view, the faded edges, and a kept tab width. */
export interface TabRowState {
  /** The keys of the tabs that are out of view, also in part. */
  hidden: string[];
  fadeStart: boolean;
  fadeEnd: boolean;
  frozen: number;
}

/**
 * The scroll of a row of tabs that have one width, as the browser tab row and the side panel header
 * use it. The row scrolls (also with a vertical wheel), its edges fade, and `row.hidden` lists the
 * tabs out of view. After a close with the pointer, `freeze` keeps the tab width until `unfreeze`, so
 * the next X is under the pointer.
 */
export function createTabRow(options: {
  list: () => HTMLElement | undefined;
  /** The tabs in the list, in order. */
  tabs: (list: HTMLElement) => HTMLElement[];
  key: (tab: HTMLElement) => string;
  /** Runs after each measure. */
  measured?: () => void;
}) {
  const [row, setRow] = createStore<TabRowState>({ hidden: [], fadeStart: false, fadeEnd: false, frozen: 0 });
  let frame = 0;
  const tab = (key: string) => {
    const list = options.list();
    return list ? options.tabs(list).find((element) => options.key(element) === key) : undefined;
  };

  /** Scrolls only the row, not the window, until the tab shows whole. */
  const reveal = (key: string) => {
    const list = options.list();
    const element = tab(key);
    if (!list || !element) return;
    const inset = Number.parseFloat(getComputedStyle(list).paddingInlineStart) || 0;
    const left = element.offsetLeft - inset;
    const right = element.offsetLeft + element.offsetWidth + inset;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (left < list.scrollLeft) list.scrollTo({ left, behavior });
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior });
  };

  /** Finds the tabs out of view. Offsets ignore a transform, so a moving tab counts at its new place. */
  const measureNow = () => {
    frame = 0;
    const list = options.list();
    if (!list) return;
    const start = list.scrollLeft;
    const end = start + list.clientWidth;
    const width = list.scrollWidth;
    const hidden = options
      .tabs(list)
      .filter((element) => element.offsetLeft < start - 1 || element.offsetLeft + element.offsetWidth > end + 1)
      .map(options.key);
    setRow((state) => {
      if (state.hidden.length !== hidden.length || hidden.some((key, i) => key !== state.hidden[i]))
        state.hidden = hidden;
      state.fadeStart = start > 1;
      state.fadeEnd = end < width - 1;
    });
    options.measured?.();
  };
  /** One measure in the next frame for all calls before it. */
  const measure = () => {
    if (!frame) frame = requestAnimationFrame(measureNow);
  };

  /**
   * Near an end of the row, scrolls the row under a held tab at `x`, faster nearer the end, so the tab
   * can go to a place out of view. Returns true when the row scrolled.
   */
  const scrollAtEdge = (x: number) => {
    const list = options.list();
    if (!list) return false;
    const bounds = list.getBoundingClientRect();
    const speed =
      x < bounds.left + EDGE_ZONE_PX
        ? -(1 - Math.max(0, x - bounds.left) / EDGE_ZONE_PX)
        : x > bounds.right - EDGE_ZONE_PX
          ? 1 - Math.max(0, bounds.right - x) / EDGE_ZONE_PX
          : 0;
    if (!speed) return false;
    list.scrollLeft += speed * EDGE_SPEED_PX;
    return true;
  };

  const freeze = (key: string) => {
    const width = tab(key)?.offsetWidth;
    if (width)
      setRow((state) => {
        state.frozen = width;
      });
  };
  const unfreeze = () => {
    if (row.frozen)
      setRow((state) => {
        state.frozen = 0;
      });
  };

  createEffect(
    () => row.frozen,
    () => measure(),
  );

  /** Measures the row when it scrolls or resizes, and lets a vertical wheel scroll it. Returns the cleanup. */
  const bind = (list: HTMLElement) => {
    // A pinch (Ctrl+wheel) zooms the page.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
    };
    const sizes = new ResizeObserver(measure);
    sizes.observe(list);
    list.addEventListener("wheel", onWheel, { passive: false });
    list.addEventListener("scroll", measure, { passive: true });
    list.addEventListener("transitionend", measure);
    return () => {
      sizes.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      list.removeEventListener("wheel", onWheel);
      list.removeEventListener("scroll", measure);
      list.removeEventListener("transitionend", measure);
    };
  };

  return { row, tab, reveal, measure, scrollAtEdge, freeze, unfreeze, bind };
}
