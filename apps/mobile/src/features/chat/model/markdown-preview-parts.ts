import type { Token } from "marked";
import { PREVIEW_PART_CHARACTERS } from "./attachment-file-preview";
import { parseChatMarkdownDocument } from "./chat-markdown-parser";

const CODE_PART_CHARACTERS = 2_000;
export const SCROLLING_CODE_LINES = 25;
const MARKDOWN_PART_CHARACTERS = 4_000;

export type MarkdownPreviewPart =
  | { kind: "markdown"; key: string; source: string }
  | {
      kind: "code";
      key: string;
      text: string;
      language: string | undefined;
      pieces: string[];
    };

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

export interface MarkdownPreviewSeries {
  parts: MarkdownPreviewPart[];
  next: number | null;
  definitions: Readonly<Record<string, string>>;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

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
