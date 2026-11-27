import { Marked, type Token, type Tokens } from "marked";
import { attachmentReferenceAt } from "./attachment-references";
import { blockChatMath, chatMathBlockStart, chatMathStart, inlineChatMath } from "./chat-math";
import { chatTagReferences, expandChatTagReferences } from "./chat-tag-references";

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
      name: "chatTag",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const file = attachmentReferenceAt(source);
        if (file) return { type: "chatTag", raw: file.marker, text: file.name };
        const reference = chatTagReferences(source)[0];
        if (reference?.start !== 0) return undefined;
        const raw = source.slice(0, reference.end);
        const text = reference.kind === "quote" ? `“${reference.name}”` : expandChatTagReferences(raw);
        return { type: "chatTag", raw, text };
      },
    },
  ],
});

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

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

function inlineText(tokens: Token[], lineBreak = " "): string {
  let text = "";
  for (const [index, token] of tokens.entries()) {
    const intraword = isWordStarEmphasis(token, text, tokens[index + 1]?.raw ?? "");
    text += intraword ? token.raw : plainText(token, lineBreak);
  }
  return text;
}

export function isWordStarEmphasis(token: Token, before: string, after: string): boolean {
  return (
    token.type === "em" &&
    token.raw.startsWith("*") &&
    (WORD_CHARACTER.test(before.at(-1) ?? "") || WORD_CHARACTER.test(after.at(0) ?? ""))
  );
}

export function markdownPreviewText(body: string): string {
  return markdown
    .lexer(body)
    .map((token) => plainText(token))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function markdownImageName(alt: string, url: string): string {
  if (alt.trim()) return alt.trim();
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.split(/[\\/]/u).pop() ?? "");
    if (name) return name;
  } catch {}
  return url;
}

function childTokens(token: Token): Token[] {
  if (token.type === "list") return token.items;
  if (token.type === "table") return [token.header, ...token.rows].flat().flatMap((cell) => cell.tokens);
  return "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
}

function imageNames(tokens: readonly Token[]): string[] {
  return tokens.flatMap((token) =>
    token.type === "image" ? [markdownImageName(token.text, token.href)] : imageNames(childTokens(token)),
  );
}

export function markdownImageNames(body: string): string[] {
  return imageNames(markdown.lexer(body));
}

export function markdownInlinePlainText(body: string): string {
  return inlineText(new markdown.Lexer(markdown.defaults).inlineTokens(body)).replace(/\s+/gu, " ").trim();
}

export function thoughtTitle(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  return markdownInlinePlainText(line.replace(/^\s*#{1,6}\s+/u, ""));
}

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

export function markdownPlainText(body: string): string {
  return markdown
    .lexer(body)
    .map(blockText)
    .filter((text) => text.trim())
    .join("\n\n")
    .trim();
}
