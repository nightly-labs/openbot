import { onSettled } from "solid-js";

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

const TRAILING_EDGE_DELAY = "70ms";

function slideTime(element: HTMLElement) {
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(",").map((value) => Number.parseFloat(value) * 1000);
  const delays = style.transitionDelay.split(",").map((value) => Number.parseFloat(value) * 1000);
  return Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] ?? 0)));
}

export function TabShape(props: { selected: string; sized: string; scroller?: string | undefined }) {
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
    const changed = (records: MutationRecord[]) => {
      if (!records.some((record) => record.target !== element)) return;
      sizes.unobserve(row);
      sizes.observe(row);
    };
    const watchList = () => {
      const next = scroller ? row.querySelector<HTMLElement>(scroller) : null;
      if (next === list) return;
      list?.removeEventListener("scroll", place);
      list = next;
      list?.addEventListener("scroll", place, { passive: true });
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
      if (getComputedStyle(element).display === "none") {
        hide();
        return;
      }
      watchList();
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
      const scale = parent.offsetWidth > 0 ? area.width / parent.offsetWidth : 1;
      const box = tab.getBoundingClientRect();
      let start = box.left;
      let end = box.right;
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
        const moved =
          shown &&
          lastTab !== null &&
          lastLeft !== null &&
          (row.contains(lastTab) ? !lastTab.matches(selected) : left >= lastRight || left + width <= lastLeft);
        element.style.setProperty("--tab-shape-start-delay", towardEnd ? TRAILING_EDGE_DELAY : "0ms");
        element.style.setProperty("--tab-shape-end-delay", towardEnd ? "0ms" : TRAILING_EDGE_DELAY);
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
        element.getBoundingClientRect();
        delete element.dataset.instant;
      }
      lastLeft = left;
      lastRight = left + width;
    };
    const sizes = new ResizeObserver(place);
    const observed = new Set<Element>();
    const changes = new MutationObserver(changed);
    changes.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
    const appearance = new MutationObserver(schedule);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["data-openbot-window-glass"] });
    sizes.observe(row);
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
