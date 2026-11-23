import { prefersReducedMotion } from "../utils";

const EXIT_FALLBACK_MS = 300;

export function playDialogExit(dialog: HTMLElement): void {
  if (typeof dialog.animate !== "function" || prefersReducedMotion()) return;
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
      if (event.target !== copy) return;
      clearTimeout(fallback);
      copy.remove();
    });
  });
}

function offsetWithin(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: Element | null = element;
  while (current instanceof HTMLElement && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent;
  }
  return top;
}

export function trackResultHighlight(
  results: HTMLElement,
  highlight: HTMLElement,
  onActiveRow: (row: HTMLElement | undefined) => void,
): () => void {
  let shown = false;
  const place = (instant: boolean) => {
    const active = results.querySelector<HTMLElement>(".global-search-result[data-highlighted]") ?? undefined;
    onActiveRow(active);
    const row = active ?? results.querySelector<HTMLElement>(".global-search-result[data-first]");
    highlight.hidden = !row;
    if (!row) {
      shown = false;
      return;
    }
    highlight.toggleAttribute("data-instant", instant || !shown);
    shown = true;
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.transform = `translateY(${offsetWithin(row, results)}px)`;
  };
  place(true);
  const observer = new MutationObserver((records) => {
    const changes = records.filter((record) => record.target !== highlight);
    if (changes.length === 0) return;
    place(changes.some((record) => record.attributeName === "data-list"));
  });
  observer.observe(results, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-highlighted", "data-first", "data-list", "style"],
  });
  return () => observer.disconnect();
}

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
  window.addEventListener("resize", place);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", place);
  };
}
