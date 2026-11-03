import { cleanAgentMessageText } from "./agent-message-text";

/**
 * The lead of an agent message, for a notification and a Live Activity. A notification is a glance:
 * it shows the first sentences of the message, not the full message. Code blocks, tables, headings
 * and mail headers are not prose, so the lead skips them. The result is Markdown source: a desktop
 * notification makes it plain text, and the Live Activity keeps its inline marks.
 *
 * The caller redacts the secrets first. The marks of the shared log redaction, such as
 * `[redacted-email]`, then show as `•••`, and internal tool names, such as `openbot.revise_skill`,
 * show as words ("revise skill").
 *
 * The lead takes whole sentences while they fit in `limit` characters. It always has the first
 * sentence, so the caller still cuts a long first sentence at its own limit.
 */
export function messageSummary(text: string, limit: number): string {
  const source = hideRedactionMarks(cleanAgentMessageText(text).slice(0, READ_LIMIT));
  let summary = "";
  let length = 0;
  for (const [index, part] of messageParts(source).entries()) {
    // The first paragraph is the lead. The next ones come in only while the lead is short.
    if (index > 0 && part.blockStart && length >= limit / 2) break;
    const text = readable(part.text);
    for (const [pieceIndex, piece] of (part.item ? [text] : sentences(text)).entries()) {
      const size = Array.from(piece).length;
      // A lead that is still short takes the next sentence too, and the caller cuts it.
      if (length >= limit / 2 && length + 1 + size > limit) return summary;
      // A list item keeps its line, so that the Markdown still reads it as an item. A CJK stop
      // has no space after it.
      const separator =
        length === 0
          ? ""
          : pieceIndex > 0
            ? CJK_STOP.test(summary)
              ? ""
              : " "
            : part.item
              ? "\n"
              : part.blockStart
                ? "\n\n"
                : " ";
      summary += separator + piece;
      length += size + separator.length;
      if (length > limit) return summary;
    }
  }
  return summary;
}

/** The start of a message that the summary reads, so that a long message is not parsed in full. */
const READ_LIMIT = 2_000;
/** What a notification shows for a secret that the redaction hid. */
const HIDDEN = "•••";
/** The marks of the shared log redaction, such as `[redacted]` and `[redacted-email]`. */
const REDACTION_MARK = /\[redacted(?:-[a-z]+)?\]/gu;
/**
 * A mail or protocol header, such as `In-Reply-To: <…>` or `Message-ID: …`: capitalized words with
 * hyphens, then a colon. A sentence starts with one word, so it does not look like this. A header
 * of one word, such as `References: <…>`, has only addresses or message IDs as its value.
 */
const HEADER_LINE =
  /^\s*(?:(?:[A-Z][A-Za-z0-9]*-)+[A-Z][A-Za-z0-9]*:(?:\s|$)|[A-Z][A-Za-z]*:\s*(?:<[^<>\s]*(?:@|•••)[^<>\s]*>[\s,]*)+$)/u;
/** The same header with its `<…>` value inside a sentence. */
const INLINE_HEADER = /\b(?:[A-Z][A-Za-z0-9]*-)+[A-Z][A-Za-z0-9]*:\s*<[^<>\n]*>/gu;
/** An internal tool name with a namespace, such as `openbot.revise_skill`. Paths and links do not match. */
const DOTTED_TOOL = /(?<![\w./:@-])(?:[a-z][a-z0-9]*\.)+([a-z0-9]+(?:_[a-z0-9]+)+)(?![\w/@-])/gu;
/** An MCP tool name, such as `mcp__server__send_message`. */
const MCP_TOOL = /(?<![\w./:@-])mcp__[a-z0-9_-]*__([a-z0-9-]+(?:_[a-z0-9-]+)*)(?![\w/@-])/gu;
/** A code fence. A backtick fence has no backtick after its marker, so "```npm install``` first" is text. */
const FENCE = /^\s{0,3}(`{3,}(?!.*`)|~{3,})/u;
const HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/u;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/u;
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/u;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/u;
/** An abbreviation whose stop does not end the sentence. */
const CJK_STOP = /[。！？]$/u;
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|approx|Mr|Mrs|Ms|Dr|St|No)\.$/iu;

interface MessagePart {
  text: string;
  /** A list item, which keeps its own line. */
  item: boolean;
  /** The first part of a paragraph or a list. */
  blockStart: boolean;
}

/** Text with `•••` for each mark of the shared log redaction, such as `[redacted-email]`. */
export function hideRedactionMarks(text: string): string {
  return text.replace(REDACTION_MARK, HIDDEN);
}

/** The headers in a sentence and the tool names as a reader can read them. */
function readable(text: string): string {
  return text
    .replace(INLINE_HEADER, "")
    .replaceAll(`<${HIDDEN}>`, HIDDEN)
    .replace(/`([^`\n]+)`/gu, (span, code: string) => {
      const words = toolWords(code.trim());
      return words ?? span;
    })
    .replace(DOTTED_TOOL, (_, name: string) => name.replaceAll("_", " "))
    .replace(MCP_TOOL, (_, name: string) => name.replaceAll("_", " "));
}

/** The words of a code span that is only a tool name, or null for other code. */
function toolWords(code: string): string | null {
  const match = new RegExp(`^(?:${DOTTED_TOOL.source}|${MCP_TOOL.source})$`, "u").exec(code);
  const name = match?.[1] ?? match?.[2];
  return name ? name.replaceAll("_", " ") : null;
}

/**
 * The prose of a message: paragraphs and list items, in order. Code blocks, tables, rules, headings
 * and header lines are left out. A message with no prose falls back to its headings, then its code.
 */
function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const headings: string[] = [];
  const code: string[] = [];
  let fence: string | null = null;
  let paragraph: string[] = [];
  let blockStart = true;
  const endParagraph = () => {
    if (paragraph.length) parts.push({ text: paragraph.join(" "), item: false, blockStart });
    if (paragraph.length) blockStart = false;
    paragraph = [];
  };
  const endBlock = () => {
    endParagraph();
    blockStart = true;
  };
  for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
      else if (line.trim()) code.push(line.trim());
      continue;
    }
    const opening = FENCE.exec(line)?.[1];
    if (opening) {
      endBlock();
      fence = opening;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      endBlock();
      continue;
    }
    // A line of `=` or `-` under one paragraph line makes that line a heading.
    if (SETEXT_UNDERLINE.test(line) && paragraph.length === 1) {
      headings.push(paragraph[0] ?? "");
      paragraph = [];
      endBlock();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading || RULE.test(line) || trimmed.startsWith("|")) {
      if (heading?.[1]) headings.push(heading[1]);
      endBlock();
      continue;
    }
    if (HEADER_LINE.test(line)) continue;
    if (LIST_ITEM.test(line)) {
      endParagraph();
      parts.push({ text: trimmed, item: true, blockStart });
      blockStart = false;
      continue;
    }
    // A line under a list item continues that item.
    const last = parts.at(-1);
    if (!paragraph.length && last?.item && !blockStart && /^\s/u.test(line)) {
      last.text = `${last.text} ${trimmed}`;
      continue;
    }
    paragraph.push(trimmed);
  }
  endParagraph();
  if (parts.length) return parts;
  if (headings.length) return [{ text: headings.join(". "), item: false, blockStart: true }];
  const firstCode = code[0];
  return firstCode ? [{ text: `\`${firstCode.replaceAll("`", "")}\``, item: false, blockStart: true }] : [];
}

/** A paragraph cut after each sentence stop that is outside a code span and not an abbreviation. */
function sentences(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?…]+["'”’)\]]*(?=\s)|[。！？]+/gu)) {
    const end = match.index + match[0].length;
    const before = text.slice(0, end);
    if ((before.match(/`/gu)?.length ?? 0) % 2 === 1) continue;
    if (ABBREVIATION.test(text.slice(start, match.index + 1))) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) result.push(sentence);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) result.push(rest);
  return result;
}
