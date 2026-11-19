import { cleanAgentMessageText } from "./agent-message-text";

export function messageSummary(text: string, limit: number): string {
  const source = hideRedactionMarks(cleanAgentMessageText(text).slice(0, READ_LIMIT));
  let summary = "";
  let length = 0;
  for (const [index, part] of messageParts(source).entries()) {
    if (index > 0 && part.blockStart && length >= limit / 2) break;
    const text = readable(part.text);
    for (const [pieceIndex, piece] of (part.item ? [text] : sentences(text)).entries()) {
      const size = Array.from(piece).length;
      if (length >= limit / 2 && length + 1 + size > limit) return summary;
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

const READ_LIMIT = 2_000;
const HIDDEN = "•••";
const REDACTION_MARK = /\[redacted(?:-[a-z]+)?\]/gu;
const HEADER_LINE =
  /^\s*(?:(?:[A-Z][A-Za-z0-9]*-)+[A-Z][A-Za-z0-9]*:(?:\s|$)|[A-Z][A-Za-z]*:\s*(?:<[^<>\s]*(?:@|•••)[^<>\s]*>[\s,]*)+$)/u;
const INLINE_HEADER = /\b(?:[A-Z][A-Za-z0-9]*-)+[A-Z][A-Za-z0-9]*:\s*<[^<>\n]*>/gu;
const DOTTED_TOOL = /(?<![\w./:@-])(?:[a-z][a-z0-9]*\.)+([a-z0-9]+(?:_[a-z0-9]+)+)(?![\w/@-])/gu;
const MCP_TOOL = /(?<![\w./:@-])mcp__[a-z0-9_-]*__([a-z0-9-]+(?:_[a-z0-9-]+)*)(?![\w/@-])/gu;
const FENCE = /^\s{0,3}(`{3,}(?!.*`)|~{3,})/u;
const HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/u;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/u;
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/u;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/u;
const CJK_STOP = /[。！？]$/u;
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|approx|Mr|Mrs|Ms|Dr|St|No)\.$/iu;

interface MessagePart {
  text: string;
  item: boolean;
  blockStart: boolean;
}

export function hideRedactionMarks(text: string): string {
  return text.replace(REDACTION_MARK, HIDDEN);
}

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

function toolWords(code: string): string | null {
  const match = new RegExp(`^(?:${DOTTED_TOOL.source}|${MCP_TOOL.source})$`, "u").exec(code);
  const name = match?.[1] ?? match?.[2];
  return name ? name.replaceAll("_", " ") : null;
}

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
