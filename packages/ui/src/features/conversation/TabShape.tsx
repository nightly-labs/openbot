import { onSettled } from "solid-js";

/** Attributes that change which tab is selected, or where the tabs are. */
const WATCHED_ATTRIBUTES = [
  "aria-selected",
  "data-selected",
  "data-fold",
  "data-mode",
  "data-model-fit",
  "data-dragged",
  "style",
  "hidden",
];

/** How long the edge on the far side of a move waits, so the shape first stretches toward the new tab. */
const TRAILING_EDGE_DELAY = "70ms";

/** The longest transition of the shape, with its delay, in milliseconds. */
function slideTime(element: HTMLElement) {
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(",").map((value) => Number.parseFloat(value) * 1000);
  const delays = style.transitionDelay.split(",").map((value) => Number.parseFloat(value) * 1000);
  return Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] ?? 0)));
}

/**
 * A shape under the selected tab of a tab row that joins the tab to the card below the row. The app's
 * styles show it only where the row sits on the card. The row is the parent element of the shape.
 *
 * The shape slides only when the selection moves to another tab: the edge on the side of the move starts
 * first and the other edge follows. When the layout moves the selected tab, as when a panel opens or the
 * window changes size, the shape moves with the tab in the same frame.
 *
 * The shape is behind the content of the row, so it never covers a tab's label or controls.
 */
export function TabShape(props: {
  /** The selected tab in the row. */
  selected: string;
  /** The parts of the row whose size moves the selected tab. */
  sized: string;
  /** The part of the row that scrolls its tabs, if there is one. */
  scroller?: string | undefined;
}) {
  let shape: HTMLSpanElement | undefined;
  onSettled(() => {
    const element = shape;
    const row = element?.parentElement;
    if (!element || !row) return;
    const { selected, sized, scroller } = props;
    let frame = 0;
    let lastTab: Element | null = null;
    let lastLeft: number | null = null;
    let lastRight = 0;
    let slideEnd = 0;
    let list: HTMLElement | null = null;
    const schedule = () => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
    };
    // A change in the row comes before the next paint, so the shape moves in the frame that the row changes.
    // The shape's own changes do not move it.
    const changed = (records: MutationRecord[]) => {
      if (records.some((record) => record.target !== element)) place();
    };
    const watchList = () => {
      const next = scroller ? row.querySelector<HTMLElement>(scroller) : null;
      if (next === list) return;
      list?.removeEventListener("scroll", place);
      list = next;
      list?.addEventListener("scroll", place, { passive: true });
      // New tabs, such as those of another agent: the shape goes to its tab at once.
      lastLeft = null;
    };
    const hide = () => {
      element.dataset.hidden = "";
      lastTab = null;
      lastLeft = null;
    };
    const place = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      // Where the row is not on the card, the shape does not show and nothing is measured. When it shows
      // again, it starts on its tab and does not slide from an old place.
      if (getComputedStyle(element).display === "none") {
        hide();
        return;
      }
      watchList();
      // New tabs need an observer too. A removed tab is not observed again, so the observer does not keep it.
      for (const part of observed) {
        if (!part.isConnected) {
          sizes.unobserve(part);
          observed.delete(part);
        }
      }
      for (const part of row.querySelectorAll(sized)) {
        if (observed.has(part)) continue;
        sizes.observe(part);
        observed.add(part);
      }
      const tab = row.querySelector<HTMLElement>(selected);
      const parent = element.offsetParent;
      if (!tab || !(parent instanceof HTMLElement) || !tab.checkVisibility({ visibilityProperty: true })) {
        hide();
        return;
      }
      const area = parent.getBoundingClientRect();
      // A zoomed or scaled page has rectangles in screen pixels and positions in CSS pixels.
      const scale = parent.offsetWidth > 0 ? area.width / parent.offsetWidth : 1;
      const box = tab.getBoundingClientRect();
      let start = box.left;
      let end = box.right;
      // A tab that is partly scrolled out of the tab list joins the card only where it shows.
      if (list?.contains(tab)) {
        const view = list.getBoundingClientRect();
        start = Math.max(start, view.left);
        end = Math.min(end, view.right);
      }
      if (end - start < 1) {
        hide();
        return;
      }
      const left = (start - area.left) / scale - parent.clientLeft;
      const width = (end - start) / scale;
      const top = (box.top - area.top) / scale - parent.clientTop;
      const bottom = (row.getBoundingClientRect().bottom - area.top) / scale - parent.clientTop;
      const shown = lastLeft !== null && element.dataset.hidden === undefined;
      const towardEnd = lastLeft !== null && left > lastLeft;
      const now = performance.now();
      if (tab !== lastTab) {
        // When the row shows the same selection with a new element, as a narrow row does, the shape does not
        // slide. A removed tab tells only by its place: a new selection does not overlap it.
        const moved =
          shown &&
          lastTab !== null &&
          lastLeft !== null &&
          (row.contains(lastTab) ? !lastTab.matches(selected) : left >= lastRight || left + width <= lastLeft);
        element.style.setProperty("--tab-shape-start-delay", towardEnd ? TRAILING_EDGE_DELAY : "0ms");
        element.style.setProperty("--tab-shape-end-delay", towardEnd ? "0ms" : TRAILING_EDGE_DELAY);
        // A slide that is still running goes on to the new place, as when a new tab grows in.
        slideEnd = moved ? now + slideTime(element) : 0;
      }
      lastTab = tab;
      const instant = !shown || now >= slideEnd;
      if (instant) element.dataset.instant = "";
      delete element.dataset.hidden;
      element.style.setProperty("--tab-shape-left", `${left}px`);
      element.style.setProperty("--tab-shape-right", `${parent.clientWidth - left - width}px`);
      element.style.setProperty("--tab-shape-top", `${top}px`);
      element.style.setProperty("--tab-shape-height", `${Math.max(0, bottom - top)}px`);
      if (instant) {
        // The new place applies before the transition comes back.
        element.getBoundingClientRect();
        delete element.dataset.instant;
      }
      lastLeft = left;
      lastRight = left + width;
    };
    // A size change comes after layout and before paint, so the shape moves in the frame that the tab moves.
    const sizes = new ResizeObserver(place);
    const observed = new Set<Element>();
    const changes = new MutationObserver(changed);
    changes.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
    // The transparent window hides the shape (`window.css`), and no change in the row tells when it ends.
    const appearance = new MutationObserver(schedule);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["data-openbot-window-glass"] });
    sizes.observe(row);
    // A tab that opens, closes or moves animates. Its place is final at the end.
    row.addEventListener("transitionend", schedule);
    row.addEventListener("animationend", schedule);
    place();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      appearance.disconnect();
      sizes.disconnect();
      list?.removeEventListener("scroll", place);
      row.removeEventListener("transitionend", schedule);
      row.removeEventListener("animationend", schedule);
    };
  });
  return <span ref={shape} class="tab-shape" aria-hidden="true" data-hidden="" />;
}
