import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { Marked, type Token } from "marked";

export const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "agentMention",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start === 0 && reference.kind === "agent")
          return { type: "agentMention", raw: source.slice(0, reference.end) };
      },
    },
  ],
});

export function parseChatMarkdown(body: string) {
  return markdown.lexer(body);
}

/** The text a reader sees in a token, without the Markdown marks. */
function plainText(token: Token): string {
  if (token.type === "agentMention") return `@${chatTagReferences(token.raw)[0]?.name ?? ""}`;
  if (token.type === "checkbox" || token.type === "space" || token.type === "hr" || token.type === "def") return "";
  if (token.type === "br") return " ";
  if (token.type === "list" && "items" in token && Array.isArray(token.items))
    return token.items.map((item: Token) => plainText(item)).join(" ");
  if (token.type === "table" && "header" in token && Array.isArray(token.header))
    return token.header.map((cell: { text: string }) => cell.text).join(" ");
  if ("tokens" in token && Array.isArray(token.tokens)) return token.tokens.map(plainText).join("");
  if (token.type === "html") return "";
  return "text" in token && typeof token.text === "string" ? token.text : token.raw;
}

/**
 * A message as one line of plain text, for a list preview: the headings, emphasis, code and list
 * marks are removed, and the blocks are joined with spaces.
 */
export function markdownPreviewText(body: string): string {
  return parseChatMarkdown(body).map(plainText).join(" ").replace(/\s+/gu, " ").trim();
}
