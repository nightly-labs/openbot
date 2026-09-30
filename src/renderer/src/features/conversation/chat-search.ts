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

/** Lowercased text. When lowercasing changed the length, each unit keeps its source offsets. */
interface LowercaseText {
  text: string;
  starts?: number[];
  ends?: number[];
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

/** Elements that start a new rendered line. */
const LINE_CONTAINER_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

/** A code block renders each line as its own span, with no newline between them. */
const CODE_LINE_CLASS = "message-code-line";

function lineContainer(text: Text, message: HTMLElement): Element {
  for (let element = text.parentElement; element && element !== message; element = element.parentElement) {
    if (LINE_CONTAINER_TAGS.has(element.tagName) || element.classList.contains(CODE_LINE_CLASS)) return element;
  }
  return message;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The query as a pattern whose spaces match any run of whitespace, as the backend search does. A
 * stored newline renders as `<br>` and carries no character, so the caller puts a space at each
 * line boundary.
 */
function searchPattern(query: string): RegExp | null {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean).map(escapeRegExp);
  return terms.length > 0 ? new RegExp(terms.join("\\s+"), "gu") : null;
}

/**
 * The text lowercased for the locale, as the query is. The whole text is lowercased at once, so a
 * context rule such as the Greek final sigma applies across text nodes. Lowercasing can change the
 * length, such as `İ` outside Turkish. Then each character that changes length is lowercased alone,
 * each run between them is lowercased as a whole, and each unit keeps its source offsets.
 */
function lowercase(source: string): LowercaseText {
  const whole = source.toLocaleLowerCase();
  if (whole.length === source.length) return { text: whole };
  const starts: number[] = [];
  const ends: number[] = [];
  let text = "";
  const append = (value: string, at: number, length: number) => {
    const lower = value.toLocaleLowerCase();
    for (let unit = 0; unit < lower.length; unit += 1) {
      starts.push(at);
      ends.push(at + length);
    }
    text += lower;
  };
  let runStart = 0;
  const flush = (end: number) => {
    const run = source.slice(runStart, end);
    const lower = run.toLocaleLowerCase();
    if (lower.length === run.length) {
      for (let unit = 0; unit < run.length; unit += 1) {
        starts.push(runStart + unit);
        ends.push(runStart + unit + 1);
      }
      text += lower;
    } else {
      let at = runStart;
      for (const character of run) {
        append(character, at, character.length);
        at += character.length;
      }
    }
  };
  let offset = 0;
  for (const character of source) {
    if (character.toLocaleLowerCase().length !== character.length) {
      flush(offset);
      append(character, offset, character.length);
      runStart = offset + character.length;
    }
    offset += character.length;
  }
  flush(source.length);
  return { text, starts, ends };
}

export function findChatSearchMatches(root: HTMLElement, query: string): ChatSearchMatch[] {
  const pattern = searchPattern(query);
  if (!pattern) return [];

  const matches: ChatSearchMatch[] = [];
  for (const message of root.querySelectorAll<HTMLElement>("[data-chat-search-message]")) {
    if (message.closest(HIDDEN_TEXT)) continue;
    const segments: TextSegment[] = [];
    let text = "";
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node instanceof Element) {
          if (node.matches(HIDDEN_TEXT)) return NodeFilter.FILTER_REJECT;
          return node.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return node instanceof Text && node.data ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    let lineBreak = false;
    let line: Element | null = null;
    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) {
        const container = lineContainer(node, message);
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

    // Matches come in order, so each lookup continues from the segment of the previous match. A
    // match starts and ends on a query character, never on an added space, so both ends are in a
    // segment.
    const lower = lowercase(text);
    let index = 0;
    for (const found of lower.text.matchAll(pattern)) {
      const matchStart = lower.starts?.[found.index] ?? found.index;
      const lastUnit = found.index + found[0].length - 1;
      const matchEnd = lower.ends?.[lastUnit] ?? lastUnit + 1;
      while ((segments[index]?.end ?? Number.POSITIVE_INFINITY) <= matchStart) index += 1;
      let endIndex = index;
      while ((segments[endIndex]?.end ?? Number.POSITIVE_INFINITY) < matchEnd) endIndex += 1;
      const startSegment = segments[index];
      const endSegment = segments[endIndex];
      if (!startSegment || !endSegment) break;
      const range = document.createRange();
      range.setStart(startSegment.node, matchStart - startSegment.start);
      range.setEnd(endSegment.node, matchEnd - endSegment.start);
      matches.push({ range, message });
    }
  }
  return matches;
}
