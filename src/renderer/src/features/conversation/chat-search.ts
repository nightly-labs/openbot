const RESULTS_HIGHLIGHT = "openbot-chat-search-results";
const CURRENT_HIGHLIGHT = "openbot-chat-search-current";

export interface ChatSearchMatch {
  range: Range;
  message: HTMLElement;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

function highlightRegistry(): HighlightRegistry | undefined {
  return globalThis.CSS?.highlights;
}

export function clearChatSearchHighlights(): void {
  const registry = highlightRegistry();
  registry?.delete(RESULTS_HIGHLIGHT);
  registry?.delete(CURRENT_HIGHLIGHT);
}

export function renderChatSearchHighlights(matches: ChatSearchMatch[], currentIndex: number): void {
  const registry = highlightRegistry();
  if (!registry) return;
  registry.delete(RESULTS_HIGHLIGHT);
  registry.delete(CURRENT_HIGHLIGHT);
  if (matches.length === 0) return;

  const results = new Highlight(...matches.map((match) => match.range));
  results.priority = 1;
  registry.set(RESULTS_HIGHLIGHT, results);

  const current = matches[currentIndex];
  if (!current) return;
  const active = new Highlight(current.range);
  active.priority = 2;
  registry.set(CURRENT_HIGHLIGHT, active);
}

const HIDDEN_TEXT = '[aria-hidden="true"], .sr-only, .message-actions';

/** Elements that start a new rendered line. A code block renders each line as its own span. */
const LINE_CONTAINER =
  "address, article, aside, blockquote, dd, details, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, summary, table, td, th, tr, ul, .message-code-line";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The query as a pattern whose spaces match any run of whitespace, as the backend search does. A
 * stored newline renders as `<br>` and carries no character, so the caller puts a space at each
 * line boundary.
 */
function searchPattern(query: string): RegExp | null {
  const terms = query.trim().split(/\s+/u).filter(Boolean).map(escapeRegExp);
  return terms.length > 0 ? new RegExp(terms.join("\\s+"), "giu") : null;
}

export function findChatSearchMatches(root: HTMLElement, query: string): ChatSearchMatch[] {
  const pattern = searchPattern(query);
  if (!pattern) return [];

  const matches: ChatSearchMatch[] = [];
  for (const message of root.querySelectorAll<HTMLElement>("[data-chat-search-message]")) {
    const segments: TextSegment[] = [];
    let text = "";
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node instanceof Element) {
          return node.tagName === "BR" && !node.closest(HIDDEN_TEXT)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        if (!(node instanceof Text) || !node.data) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(HIDDEN_TEXT)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let lineBreak = false;
    let line: Element | null = null;
    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) {
        const container = node.parentElement?.closest(LINE_CONTAINER) ?? message;
        // The space belongs to no segment, so a match across it still maps to the text on both sides.
        if (segments.length > 0 && (lineBreak || container !== line)) text += " ";
        lineBreak = false;
        line = container;
        const start = text.length;
        text += node.data;
        segments.push({ node, start, end: text.length });
      } else {
        lineBreak = true;
      }
      node = walker.nextNode();
    }

    // Matches come in order, so each segment lookup continues from the previous match.
    let segmentIndex = 0;
    for (const found of text.matchAll(pattern)) {
      const matchStart = found.index;
      const matchEnd = matchStart + found[0].length;
      while ((segments[segmentIndex]?.end ?? matchStart + 1) <= matchStart) segmentIndex += 1;
      const startSegment = segments[segmentIndex];
      let endIndex = segmentIndex;
      while ((segments[endIndex]?.end ?? matchEnd) < matchEnd) endIndex += 1;
      const endSegment = segments[endIndex];
      if (startSegment && endSegment) {
        const range = document.createRange();
        range.setStart(startSegment.node, matchStart - startSegment.start);
        range.setEnd(endSegment.node, matchEnd - endSegment.start);
        matches.push({ range, message });
      }
    }
  }
  return matches;
}
