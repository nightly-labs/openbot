export type FitKind = "badge" | "select" | "tab" | "menuitem" | "option" | "header" | "button";

export interface FitProblem {
  path: string;
  kind: FitKind;
  reason: "clipped" | "overflows" | "wraps" | "outside";
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export function measureFit(scopeSelector: string): FitProblem[] {
  const CONTROLS = [
    "button",
    "a.ui-button",
    "[role=button]",
    "[role=tab]",
    "[role^=menuitem]",
    "[role=option]",
    ".z-badge",
    ".ui-select-value",
    ".ui-sliding-tabs-trigger",
    "th",
  ].join(",");
  const SINGLE_LINE = ".ui-button,[role=tab],[role^=menuitem],.z-badge,.ui-sliding-tabs-trigger,.ui-select-value";
  const problems: FitProblem[] = [];
  const seen = new Set<string>();

  const pathOf = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && node !== document.body) {
      const parent: Element | null = node.parentElement;
      const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
      parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
      node = parent;
    }
    return parts.join(">");
  };
  const kindOf = (element: Element): FitKind => {
    const role = element.getAttribute("role");
    if (element.classList.contains("z-badge")) return "badge";
    if (element.classList.contains("ui-select-value")) return "select";
    if (element.classList.contains("ui-sliding-tabs-trigger") || role === "tab") return "tab";
    if (role?.startsWith("menuitem")) return "menuitem";
    if (role === "option") return "option";
    if (element.tagName === "TH") return "header";
    return "button";
  };
  const visible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  const textLines = (element: Element): number => {
    let most = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const tops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top / 4)));
      most = Math.max(most, tops.size);
    }
    return most;
  };
  const clippedPart = (element: Element): Element | null => {
    const candidates = [element, ...Array.from(element.querySelectorAll("*"))];
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (
        !Array.from(candidate.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      )
        continue;
      if (candidate.scrollWidth > candidate.clientWidth + 1 && candidate.clientWidth > 0) return candidate;
    }
    return null;
  };
  const clipAncestor = (element: Element): Element | null => {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible") continue;
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth)
        return null;
      return node;
    }
    return null;
  };

  for (const scope of Array.from(document.querySelectorAll(scopeSelector))) {
    for (const element of Array.from(scope.querySelectorAll(CONTROLS))) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      const text = element.innerText.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const path = pathOf(element);
      const box = element.getBoundingClientRect();
      const report = (reason: FitProblem["reason"]) => {
        const id = `${path}|${reason}`;
        if (seen.has(id)) return;
        seen.add(id);
        problems.push({
          path,
          kind: kindOf(element),
          reason,
          text: text.slice(0, 120),
          rect: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      };
      const clipped = clippedPart(element);
      if (clipped) {
        const style = getComputedStyle(clipped);
        report(style.overflowX === "visible" ? "overflows" : "clipped");
      }
      if (element.matches(SINGLE_LINE) && textLines(element) > 1) report("wraps");
      const clip = clipAncestor(element);
      if (clip) {
        const bounds = clip.getBoundingClientRect();
        if (box.right > bounds.right + 1 || box.left < bounds.left - 1) report("outside");
      } else if (box.right > window.innerWidth + 1) report("outside");
    }
  }
  return problems;
}
