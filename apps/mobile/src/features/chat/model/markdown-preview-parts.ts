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
  /** The reference link definitions found so far, which each later row also gets. */
  definitions: string;
}

/**
 * The rows of the part of a Markdown file from `start`, about `PREVIEW_PART_CHARACTERS` long, so a
 * long file shows in parts as the reader scrolls. A part ends after a whole block: the last block of
 * the cut text can go on past the cut, so it starts the next part. A block longer than one part
 * makes the part longer. `source` has `\n` line ends, as the parser counts them.
 *
 * Blocks of Markdown join into rows of a few thousand characters. A code block of more than 25
 * lines, or of more characters than one piece, is a row of its own that scrolls inside. The
 * definitions of reference links go with each row, so a link in a row opens.
 */
export function markdownPreviewSeries(source: string, start = 0, known = ""): MarkdownPreviewSeries {
  let length = PREVIEW_PART_CHARACTERS;
  for (;;) {
    const end = Math.min(source.length, start + length);
    const tokens = parseChatMarkdownDocument(source.slice(start, end));
    const last = end === source.length;
    const blocks = last ? tokens : tokens.slice(0, -1);
    const read = blocks.reduce((total, token) => total + token.raw.length, 0);
    if (!last && read === 0) {
      length *= 2;
      continue;
    }
    const found = Object.entries(tokens.links)
      .map(
        ([label, link]) => `[${label}]: <${link.href}>${link.title ? ` "${link.title.replaceAll('"', '\\"')}"` : ""}`,
      )
      .join("\n");
    const definitions = [known, found].filter(Boolean).join("\n");
    return { parts: previewRows(blocks, start, definitions), next: last ? null : start + read, definitions };
  }
}

function previewRows(tokens: Token[], from: number, definitions: string): MarkdownPreviewPart[] {
  const parts: MarkdownPreviewPart[] = [];
  let markdown = "";
  let offset = from;
  let start = from;
  const flush = () => {
    if (markdown.trim())
      parts.push({
        kind: "markdown",
        key: `markdown-${start}`,
        source: definitions ? `${markdown}\n\n${definitions}` : markdown,
      });
    markdown = "";
  };
  for (const token of tokens) {
    if (token.type === "code" && typeof token.text === "string" && scrollingCode(token.text)) {
      flush();
      const text: string = token.text;
      parts.push({
        kind: "code",
        key: `code-${offset}`,
        text,
        language: typeof token.lang === "string" && token.lang ? token.lang : undefined,
        pieces: codePieces(text),
      });
    } else {
      if (!markdown) start = offset;
      markdown += token.raw;
      if (markdown.length >= MARKDOWN_PART_CHARACTERS) flush();
    }
    offset += token.raw.length;
  }
  flush();
  return parts;
}
