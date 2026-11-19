/** Elements with no text for a reader. The message text already holds the page title. */
const HIDDEN_END: ReadonlyMap<string, RegExp> = new Map([
  ["script", /<\/script\s*>/giu],
  ["style", /<\/style\s*>/giu],
  ["template", /<\/template\s*>/giu],
  // The end tag of `head` is optional: the body starts without it.
  ["head", /<\/head\s*>|(?=<body\b)/giu],
]);
const CELLS = new Set(["td", "th"]);
const BLOCKS = new Set(
  "p div br hr li ul ol dl dt dd tr table h1 h2 h3 h4 h5 h6 section article header footer main aside nav blockquote pre figure figcaption details summary text".split(
    " ",
  ),
);
const TAG_NAME = /^<\/?([a-z][a-z0-9]*)/iu;
const ENTITIES = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

function entity(match: string, name: string): string {
  const lower = name.toLowerCase();
  if (!lower.startsWith("#")) return NAMED_ENTITIES[lower] ?? match;
  const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

/** The index of the `>` that ends the tag at `open`, or -1. A `>` in a quoted attribute value is not the end. */
function tagEnd(html: string, open: number): number {
  let quote = "";
  for (let index = open + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

/**
 * The page without its tags, comments and hidden elements: a block tag becomes a line break. One
 * pass that reads each character once, because a page can be large and its markup can be incorrect.
 */
function withoutTags(html: string): string {
  const parts: string[] = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) break;
    parts.push(html.slice(index, open));
    index = html.length;
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      if (end >= 0) index = end + 3;
      continue;
    }
    const name = TAG_NAME.exec(html.slice(open, open + 24))?.[1]?.toLowerCase();
    // A declaration such as `<!doctype html>` is markup with no name.
    if (!name && html[open + 1] !== "!" && html[open + 1] !== "?") {
      // A "<" of the text, as in "a < b".
      parts.push("<");
      index = open + 1;
      continue;
    }
    // A tag with no end stops the loop, so at most one search reads to the end of the page.
    const close = name ? tagEnd(html, open) : html.indexOf(">", open);
    if (close < 0) continue;
    index = close + 1;
    if (!name) continue;
    const hiddenEnd = html[open + 1] === "/" ? undefined : HIDDEN_END.get(name);
    if (hiddenEnd) {
      // An element with no end hides the rest of the page.
      hiddenEnd.lastIndex = index;
      index = hiddenEnd.exec(html) ? hiddenEnd.lastIndex : html.length;
    } else if (CELLS.has(name)) parts.push(" ");
    else if (BLOCKS.has(name)) parts.push("\n");
  }
  parts.push(html.slice(index));
  return parts.join("");
}

/**
 * The text that a reader sees on a visual reply page, one line for each block, for `history_read`.
 * A page that draws all its content with scripts has no such text: then the page source is the answer.
 */
export function visualPageText(html: string): string {
  const text = withoutTags(html)
    .replace(ENTITIES, entity)
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text || html.trim();
}
