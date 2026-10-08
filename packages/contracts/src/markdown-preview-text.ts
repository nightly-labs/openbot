import { Marked, type Token } from "marked";
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
      // A mention (`@[Chief](agent:chief)`) would otherwise read as a link.
      name: "chatTag",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start !== 0) return undefined;
        const raw = source.slice(0, reference.end);
        return { type: "chatTag", raw, text: expandChatTagReferences(raw) };
      },
    },
  ],
});

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** The text a reader sees in a token, without the Markdown marks. */
function plainText(token: Token): string {
  switch (token.type) {
    case "space":
    case "hr":
    case "def":
    case "checkbox":
      return "";
    case "br":
      return " ";
    case "html":
      return token.raw.replace(/<[^>]*>/gu, " ");
    case "list":
      return token.items.map(plainText).join(" ");
    case "blockquote":
    case "list_item":
      return (token.tokens ?? []).map(plainText).join(" ");
    case "table":
      return [token.header, ...token.rows].flat().map(plainTextOf).join(" ");
  }
  if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
  return "text" in token && typeof token.text === "string" ? token.text : token.raw;
}

function plainTextOf(cell: { tokens: Token[] }): string {
  return inlineText(cell.tokens);
}

/**
 * Joins inline tokens. A `*` pair inside a word, as in `2*3*4`, is arithmetic more often than
 * emphasis, so it stays as written.
 */
function inlineText(tokens: Token[]): string {
  let text = "";
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1];
    const intraword =
      token.type === "em" &&
      token.raw.startsWith("*") &&
      (WORD_CHARACTER.test(text.at(-1) ?? "") || WORD_CHARACTER.test(next?.raw.at(0) ?? ""));
    text += intraword ? token.raw : plainText(token);
  }
  return text;
}

/**
 * A message as one line of plain text, for a list or sidebar preview: headings, emphasis, code,
 * quotes, links, tables and list marks are removed, mentions show their name, and the blocks are
 * joined with single spaces.
 */
export function markdownPreviewText(body: string): string {
  return markdown.lexer(body).map(plainText).join(" ").replace(/\s+/gu, " ").trim();
}
