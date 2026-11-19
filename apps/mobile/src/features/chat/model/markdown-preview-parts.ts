import type { Token } from "marked";
import { PREVIEW_PART_CHARACTERS } from "./attachment-file-preview";
import { parseChatMarkdownDocument } from "./chat-markdown-parser";

/**
 * iOS draws a text into one bitmap as tall as the text. A long code block in a Markdown file, such as
 * a stack trace of a thousand lines, made a text many thousands of points tall, and the app ran out
 * of memory. A piece of a code block has at most about this many characters.
 */
const CODE_PART_CHARACTERS = 2_000;
/** A code block with more lines than this scrolls inside a box of this many lines. */
export const SCROLLING_CODE_LINES = 25;
/** Blocks of Markdown join into one part up to about this many characters, so the list has few rows. */
const MARKDOWN_PART_CHARACTERS = 4_000;

/** A part of a Markdown file that the preview list draws as one row. */
export type MarkdownPreviewPart =
  | { kind: "markdown"; key: string; source: string }
  | {
      /** A long code block, which scrolls inside a box of 25 lines. */
      kind: "code";
      key: string;
      text: string;
      language: string | undefined;
      /** The code in pieces of whole lines, which join into `text`. */
      pieces: string[];
    };

/** The pieces of a code block, of whole lines. A line longer than one piece is cut into pieces. */
function codePieces(text: string): string[] {
  const pieces: string[] = [];
  let piece: string | null = null;
  for (const line of text.split("\n")) {
    const chunks: string[] = [];
    for (let start = 0; start < line.length; start += CODE_PART_CHARACTERS)
      chunks.push(line.slice(start, start + CODE_PART_CHARACTERS));
    for (const chunk of chunks.length ? chunks : [""]) {
      if (piece !== null && piece.length + chunk.length + 1 > CODE_PART_CHARACTERS) {
        pieces.push(piece);
        piece = chunk;
      } else piece = piece === null ? chunk : `${piece}\n${chunk}`;
    }
  }
  if (piece !== null) pieces.push(piece);
  return pieces;
}

function scrollingCode(text: string): boolean {
  if (text.length > CODE_PART_CHARACTERS) return true;
  let lines = 1;
  for (const character of text) if (character === "\n" && ++lines > SCROLLING_CODE_LINES) return true;
  return false;
}

/** The rows of one part of a Markdown file, and where the next part starts. */
export interface MarkdownPreviewSeries {
  parts: MarkdownPreviewPart[];
  /** The offset of the next part in the file, or null at the end of the file. */
  next: number | null;
  /** The reference link definitions found so far, by label, for the rows of later parts. */
  definitions: Readonly<Record<string, string>>;
}

/** A fence that opens or closes a fenced code block, such as ```` ``` ```` or `~~~`. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

/**
 * The end of the part of `source` from `start`: after a blank line outside a fenced code block, at
 * about `PREVIEW_PART_CHARACTERS`, so a block is never cut. A code block longer than one part makes
 * the part longer. The cut comes from the text, not from the lengths of the parsed blocks: the
 * parser does not keep each character of the text in its blocks.
 */
function partEnd(source: string, start: number): number {
  const limit = start + PREVIEW_PART_CHARACTERS;
  if (source.length <= limit) return source.length;
  let fence: string | null = null;
  let cut = -1;
  let index = start;
  while (index < source.length) {
    const newline = source.indexOf("\n", index);
    const end = newline === -1 ? source.length : newline + 1;
    const line = source.slice(index, end);
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else if (marker) fence = marker;
    else if (!line.trim() && index > start) {
      if (end <= limit || cut === -1) cut = end;
      if (end > limit) break;
    }
    index = end;
  }
  return cut === -1 ? source.length : cut;
}

/**
 * The rows of the part of a Markdown file from `start`, about `PREVIEW_PART_CHARACTERS` long, so a
 * long file shows in parts as the reader scrolls. A part ends at a blank line between blocks. A part
 * with no rows, such as one of only link definitions, reads on, so each call that is not at the end
 * of the file gives rows. `source` has `\n` line ends.
 *
 * Blocks of Markdown join into rows of a few thousand characters. A code block of more than 25
 * lines, or of more characters than one piece, is a row of its own that scrolls inside. A row gets
 * the definitions of the reference links that it uses, so its links open.
 */
export function markdownPreviewSeries(
  source: string,
  start = 0,
  known: Readonly<Record<string, string>> = {},
): MarkdownPreviewSeries {
  let from = start;
  let definitions = known;
  for (;;) {
    const end = partEnd(source, from);
    const tokens = parseChatMarkdownDocument(source.slice(from, end));
    const found = Object.entries(tokens.links).map(([label, link]) => [
      label,
      `[${label}]: <${link.href}>${link.title ? ` "${link.title.replaceAll('"', '\\"')}"` : ""}`,
    ]);
    definitions = { ...definitions, ...Object.fromEntries(found) };
    const parts = previewRows(tokens, from, definitions);
    const next = end === source.length ? null : end;
    if (parts.length || next === null) return { parts, next, definitions };
    from = next;
  }
}

/** The definitions of the reference links that a row of Markdown uses, such as `[text][label]`. */
function usedDefinitions(markdown: string, definitions: Readonly<Record<string, string>>): string {
  const labels = Object.keys(definitions);
  if (!labels.length) return "";
  const text = markdown.toLowerCase();
  return labels
    .filter((label) => text.includes(`[${label}]`))
    .map((label) => definitions[label])
    .join("\n");
}

function previewRows(
  tokens: Token[],
  from: number,
  definitions: Readonly<Record<string, string>>,
): MarkdownPreviewPart[] {
  const parts: MarkdownPreviewPart[] = [];
  let markdown = "";
  const flush = () => {
    if (markdown.trim()) {
      const used = usedDefinitions(markdown, definitions);
      parts.push({
        kind: "markdown",
        key: `${from}-${parts.length}`,
        source: used ? `${markdown}\n\n${used}` : markdown,
      });
    }
    markdown = "";
  };
  for (const token of tokens) {
    if (token.type === "code" && typeof token.text === "string" && scrollingCode(token.text)) {
      flush();
      const text: string = token.text;
      parts.push({
        kind: "code",
        key: `${from}-${parts.length}`,
        text,
        language: typeof token.lang === "string" && token.lang ? token.lang : undefined,
        pieces: codePieces(text),
      });
    } else {
      markdown += token.raw;
      if (markdown.length >= MARKDOWN_PART_CHARACTERS) flush();
    }
  }
  flush();
  return parts;
}
