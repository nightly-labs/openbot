import { prefersReducedMotion } from "../utils";

// Kobalte removes a closed dialog at once, so a CSS exit cannot play. As in menu-motion.tsx, an
// inert copy of the dialog takes its place and plays the exit that the stylesheet gives to
// `[data-closing]`.
const EXIT_FALLBACK_MS = 300;

/** Puts an inert copy of the closing search dialog on the page and removes it after its exit. */
export function playDialogExit(dialog: HTMLElement): void {
  if (typeof dialog.animate !== "function" || prefersReducedMotion()) return;
  // Read now: the cleanup can run before the dialog leaves the page, and a copy keeps no scroll or typed text.
  const scrolled = Array.from(dialog.querySelectorAll("*"), (element) => element.scrollTop);
  const values = Array.from(dialog.querySelectorAll("input"), (input) => input.value);
  const copy = dialog.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.style.pointerEvents = "none";
  copy.removeAttribute("id");
  for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
  copy.dataset.closing = "";

  queueMicrotask(() => {
    // The dialog stays when only a child closed.
    if (dialog.isConnected) return;
    document.body.appendChild(copy);
    for (const [index, element] of Array.from(copy.querySelectorAll("*")).entries()) {
      const top = scrolled[index];
      if (top) element.scrollTop = top;
    }
    for (const [index, input] of Array.from(copy.querySelectorAll("input")).entries())
      input.value = values[index] ?? "";
    if (copy.getAnimations().length === 0) {
      copy.remove();
      return;
    }
    const fallback = setTimeout(() => copy.remove(), EXIT_FALLBACK_MS);
    copy.addEventListener("animationend", (event) => {
      // Rows in the copy can end their own animations first.
      if (event.target !== copy) return;
      clearTimeout(fallback);
      copy.remove();
    });
  });
}

/** The distance from the top of `ancestor` to the top of `element`, through each offset parent. */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: Element | null = element;
  while (current instanceof HTMLElement && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent;
  }
  return top;
}

/**
 * Keeps one highlight under the active row, so that it slides from row to row. A new result list,
 * which changes `data-list` on the listbox, places it at once: only a move inside the same list
 * animates. `onActiveRow` receives the active row each time it changes or renders.
 */
export function trackResultHighlight(
  results: HTMLElement,
  highlight: HTMLElement,
  onActiveRow: (row: HTMLElement | undefined) => void,
): () => void {
  let shown = false;
  const place = (instant: boolean) => {
    const active = results.querySelector<HTMLElement>(".global-search-result[data-highlighted]") ?? undefined;
    onActiveRow(active);
    // With no highlighted row, Enter opens the first one, so the highlight shows there.
    const row = active ?? results.querySelector<HTMLElement>(".global-search-result[data-first]");
    highlight.hidden = !row;
    if (!row) {
      shown = false;
      return;
    }
    // A highlight that comes back after an empty list has no place to slide from.
    highlight.toggleAttribute("data-instant", instant || !shown);
    shown = true;
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.transform = `translateY(${offsetWithin(row, results)}px)`;
  };
  place(true);
  // Rows also render and leave as the list scrolls, so a changed row alone is not a new list.
  const observer = new MutationObserver((records) => {
    place(records.some((record) => record.attributeName === "data-list"));
  });
  observer.observe(results, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-highlighted", "data-first", "data-list"],
  });
  return () => observer.disconnect();
}

/**
 * Gives the results an explicit height that follows their content, so that the dialog resizes
 * with a transition when the results change. The first height after open is placed at once.
 * `onResize` runs after each change: at the height limit, new content does not resize the results.
 */
export function trackResultsHeight(results: HTMLElement, body: HTMLElement, onResize: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  let placed = false;
  const place = () => {
    const style = getComputedStyle(results);
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const limit = Number.parseFloat(style.maxHeight);
    const height = Math.min(body.offsetHeight + padding, Number.isNaN(limit) ? Number.POSITIVE_INFINITY : limit);
    results.toggleAttribute("data-instant", !placed);
    results.style.height = `${height}px`;
    placed = true;
    onResize();
  };
  place();
  const observer = new ResizeObserver(place);
  observer.observe(body);
  // A smaller window lowers the limit without a change to the content.
  window.addEventListener("resize", place);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", place);
  };
}
