/*
 * The motion of the mention picker. The list draws its rows again for each typed character, so
 * these helpers watch the DOM and act in the frame of the change: a step that waits for the next
 * frame shows one frame of the old state.
 */

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
 * Keeps one highlight under the active row, as in the search dialog. It slides only when an arrow
 * key moves it (`keyMove`). The pointer, the query, and the first place after open move it at once,
 * because the rows under it do not move either.
 */
export function trackPickerHighlight(list: HTMLElement, keyMove: () => boolean): () => void {
  const highlight = list.ownerDocument.createElement("div");
  highlight.className = "mention-picker-highlight";
  highlight.setAttribute("aria-hidden", "true");
  let shown = false;
  const place = () => {
    // The list renders its own children again, which can drop the highlight.
    if (highlight.parentElement !== list) list.append(highlight);
    const row = list.querySelector<HTMLElement>(".mention-picker-option-active");
    highlight.hidden = !row;
    if (!row) {
      shown = false;
      return;
    }
    const slide = keyMove();
    highlight.toggleAttribute("data-instant", !(shown && slide));
    shown = true;
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.transform = `translateY(${offsetWithin(row, list)}px)`;
  };
  place();
  const own = (node: Node) => node === highlight;
  const observer = new MutationObserver((records) => {
    const changes = records.filter((record) => {
      if (record.target === highlight) return false;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return !(record.type === "childList" && nodes.length > 0 && nodes.every(own));
    });
    if (changes.length > 0) place();
  });
  observer.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
    highlight.remove();
  };
}

/**
 * Fades in each row that the last list did not have, when the query brings it back. A row that
 * stays does not move, also when the list renders it again. The rows of the first list do not fade:
 * the panel has its own entrance.
 */
export function trackEnteringPickerRows(list: HTMLElement): () => void {
  const rows = () => list.querySelectorAll<HTMLElement>("[data-option-key]");
  const keys = () => new Set(Array.from(rows(), (row) => row.dataset.optionKey ?? ""));
  let previous = keys();
  const observer = new MutationObserver(() => {
    const current = keys();
    for (const row of rows()) {
      if (previous.has(row.dataset.optionKey ?? "")) continue;
      row.setAttribute("data-entering", "");
      row.addEventListener("animationend", () => row.removeAttribute("data-entering"), { once: true });
    }
    previous = current;
  });
  observer.observe(list, { childList: true });
  return () => observer.disconnect();
}

/** Slack in pixels before an edge counts as reached, as `createScrollFades` uses. */
const EDGE = 2;

/**
 * Sets the global scroll fade classes in the frame of the change, as the rows or the scroll position
 * change. A fade that waits for the next frame shows on a list that no longer overflows.
 */
export function trackPickerScrollFades(list: HTMLElement): () => void {
  const measure = () => {
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
    list.classList.toggle("scroll-fade-top", list.scrollTop > EDGE);
    list.classList.toggle("scroll-fade-bottom", remaining > EDGE);
  };
  measure();
  const observer = new MutationObserver(measure);
  observer.observe(list, { childList: true });
  list.addEventListener("scroll", measure, { passive: true });
  return () => {
    observer.disconnect();
    list.removeEventListener("scroll", measure);
  };
}

export interface MatchPart {
  text: string;
  match: boolean;
}

/** The parts of `text` that match the query, as the search dialog marks them. */
export function matchParts(text: string, query: string): MatchPart[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const lowered = text.toLocaleLowerCase();
  // A lower-case form of another length would put the marks in the wrong place.
  if (lowered.length !== text.length) return [{ text, match: false }];
  const parts: MatchPart[] = [];
  let cursor = 0;
  let index = lowered.indexOf(needle);
  while (index >= 0) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lowered.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
