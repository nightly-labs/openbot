import { Marked, type Token, type Tokens } from "marked";
import { attachmentReferenceAt } from "./attachment-references";
import { blockChatMath, chatMathBlockStart, chatMathStart, inlineChatMath } from "./chat-math";
import { chatTagReferences, expandChatTagReferences } from "./chat-tag-references";

// The chat renders messages with `marked`, so a preview reads the same tokens and keeps their text.
const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: chatMathBlockStart,
      tokenizer(source) {
        const math = blockChatMath(source);
        if (math) return { type: "blockMath", raw: math.raw, text: math.tex };
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start: chatMathStart,
      tokenizer(source) {
        const math = inlineChatMath(source);
        if (math) return { type: "inlineMath", raw: math.raw, text: math.tex };
      },
    },
    {
      // A mention (`@[Chief](agent:chief)`) or a file (`@[notes.md](attachment:<id>)`) would otherwise
      // read as `@` and a link. A file shows its name.
      name: "chatTag",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const file = attachmentReferenceAt(source);
        if (file) return { type: "chatTag", raw: file.marker, text: file.name };
        const reference = chatTagReferences(source)[0];
        if (reference?.start !== 0) return undefined;
        const raw = source.slice(0, reference.end);
        // A one-line preview has no room for a block quote, so the quoted text stands in marks.
        const text = reference.kind === "quote" ? `“${reference.name}”` : expandChatTagReferences(raw);
        return { type: "chatTag", raw, text };
      },
    },
  ],
});

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** The text a reader sees in a token, without the Markdown marks. A line break becomes `lineBreak`. */
function plainText(token: Token, lineBreak = " "): string {
  switch (token.type) {
    case "space":
    case "hr":
    case "def":
    case "checkbox":
      return "";
    case "br":
      return lineBreak;
    case "html":
      return token.raw.replace(/<[^>]*>/gu, " ");
    case "list":
      return token.items.map((item: Tokens.ListItem) => plainText(item)).join(" ");
    case "blockquote":
    case "list_item":
      return (token.tokens ?? []).map((child) => plainText(child)).join(" ");
    case "table":
      return [token.header, ...token.rows].flat().map(plainTextOf).join(" ");
  }
  if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens, lineBreak);
  return "text" in token && typeof token.text === "string" ? token.text : token.raw;
}

function plainTextOf(cell: { tokens: Token[] }): string {
  return inlineText(cell.tokens);
}

/**
 * Joins inline tokens. A `*` pair inside a word, as in `2*3*4`, is arithmetic more often than
 * emphasis, so it stays as written.
 */
function inlineText(tokens: Token[], lineBreak = " "): string {
  let text = "";
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1];
    const intraword =
      token.type === "em" &&
      token.raw.startsWith("*") &&
      (WORD_CHARACTER.test(text.at(-1) ?? "") || WORD_CHARACTER.test(next?.raw.at(0) ?? ""));
    text += intraword ? token.raw : plainText(token, lineBreak);
  }
  return text;
}

/**
 * A message as one line of plain text, for a list or sidebar preview: headings, emphasis, code,
 * quotes, links, tables and list marks are removed, mentions show their name, and the blocks are
 * joined with single spaces.
 */
export function markdownPreviewText(body: string): string {
  return markdown
    .lexer(body)
    .map((token) => plainText(token))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Inline Markdown as one line of plain text, such as the question of an agent that a card draws as
 * inline Markdown: a line that starts with `1.` or `#` keeps that text, as the card shows it.
 */
export function markdownInlinePlainText(body: string): string {
  return inlineText(new markdown.Lexer(markdown.defaults).inlineTokens(body)).replace(/\s+/gu, " ").trim();
}

/** A list as lines, each with its bullet or number, and a nested list indented under its item. */
function listLines(token: Tokens.List, depth: number): string[] {
  const start = typeof token.start === "number" ? token.start : 1;
  return token.items.flatMap((item, index) => {
    const marker = token.ordered ? `${start + index}.` : "•";
    const indent = "  ".repeat(depth);
    const nested = item.tokens.filter(isList);
    const text = inlineText(item.tokens.filter((child) => !isList(child)))
      .replace(/\n+/gu, " ")
      .trim();
    return [`${indent}${marker} ${text}`, ...nested.flatMap((list) => listLines(list, depth + 1))];
  });
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

function blockText(token: Token): string {
  if (isList(token)) return listLines(token, 0).join("\n");
  switch (token.type) {
    case "code":
    case "blockMath":
      return typeof token.text === "string" ? token.text : token.raw;
    case "blockquote":
      return (token.tokens ?? []).map(blockText).filter(Boolean).join("\n");
    case "table":
      return [token.header, ...token.rows].map((row) => row.map(plainTextOf).join("\t")).join("\n");
    case "paragraph":
    case "heading":
    case "text":
      return inlineText(token.tokens ?? [], "\n");
  }
  return plainText(token).trim();
}

/**
 * A message as plain text that keeps its lines, for text that a reader selects: the Markdown marks
 * are removed, mentions show their name, and paragraphs, list items and table rows stay on their
 * own lines.
 */
export function markdownPlainText(body: string): string {
  return markdown
    .lexer(body)
    .map(blockText)
    .filter((text) => text.trim())
    .join("\n\n")
    .trim();
}
