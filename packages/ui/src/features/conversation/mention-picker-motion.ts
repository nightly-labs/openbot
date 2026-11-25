function offsetWithin(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: Element | null = element;
  while (current instanceof HTMLElement && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent;
  }
  return top;
}

export function trackPickerHighlight(list: HTMLElement, keyMove: () => boolean): () => void {
  const highlight = list.ownerDocument.createElement("div");
  highlight.className = "mention-picker-highlight";
  highlight.setAttribute("aria-hidden", "true");
  let shown = false;
  const place = () => {
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

export interface MatchPart {
  text: string;
  match: boolean;
}

export function matchParts(text: string, query: string): MatchPart[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const lowered = text.toLocaleLowerCase();
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
