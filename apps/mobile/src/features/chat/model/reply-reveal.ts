import type { Token, Tokens } from "marked";
import type { ChatMessage } from "./chat-messages";

export function isStreamingReply(message: ChatMessage): boolean {
  return message.kind === "message" && message.author === "agent" && message.streaming;
}

export function replyWordDelay(word: string): number {
  if (/[.!?…]["'”’)]*\s*$/u.test(word)) return 180;
  if (/[,;:]["'”’)]*\s*$/u.test(word)) return 100;
  return Math.min(80, 40 + word.trim().length * 3);
}

export function replyWordFeedback(word: string, index: number): "selection" | "soft" | "light" {
  if (/[.!?…]["'”’)]*\s*$/u.test(word)) return "light";
  return index % 4 === 0 || word.trim().length > 8 ? "soft" : "selection";
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}
function isTable(token: Token): token is Tokens.Table {
  return token.type === "table";
}
function hasChildren(token: Token): token is Token & { tokens: Token[] } {
  return "tokens" in token && Array.isArray(token.tokens);
}

/** Reveal parsed leaves without reparsing Markdown at every animation step. */
export function createReplyReveal(tokens: Token[]) {
  const words: string[] = [];
  function clip(limit: number, collect = false): Token[] {
    let remaining = limit;
    function visit(entries: Token[]): Token[] {
      const result: Token[] = [];
      for (const token of entries) {
        if (remaining <= 0) break;
        if (isList(token)) {
          const items: Tokens.ListItem[] = [];
          for (const item of token.items) {
            if (remaining <= 0) break;
            items.push({ ...item, tokens: visit(item.tokens) });
          }
          result.push({ ...token, items });
        } else if (isTable(token)) {
          const cells = (row: Tokens.TableCell[]) => row.map((cell) => ({ ...cell, tokens: visit(cell.tokens) }));
          const header = cells(token.header);
          const rows: Tokens.TableCell[][] = [];
          for (const row of token.rows) {
            if (remaining <= 0) break;
            rows.push(cells(row));
          }
          result.push({ ...token, header, rows });
        } else if (token.type === "agentMention" || token.type === "code") {
          // Code uses StreamingBlock's entrance. Keep its source intact so Copy
          // never receives a prefix produced only by the playback animation.
          if (collect) words.push(token.type === "code" ? token.text : token.raw);
          remaining -= 1;
          result.push(token);
        } else if (hasChildren(token)) {
          result.push({ ...token, tokens: visit(token.tokens) });
        } else if (token.type === "space" || token.type === "def" || token.type === "br" || token.type === "hr") {
          result.push(token);
        } else {
          const text = "text" in token && typeof token.text === "string" ? token.text : token.raw;
          const parts = Array.from(text.matchAll(/\S+\s*/gu));
          if (collect) words.push(...parts.map((part) => part[0]));
          const count = Math.min(remaining, parts.length);
          remaining -= count;
          const last = parts[count - 1];
          const prefix = last ? text.slice(0, last.index + last[0].length) : text;
          result.push(
            "text" in token && typeof token.text === "string" ? { ...token, text: prefix } : { ...token, raw: prefix },
          );
        }
      }
      return result;
    }
    return visit(tokens);
  }
  clip(Number.POSITIVE_INFINITY, true);
  return { words, at: (count: number) => (count >= words.length ? tokens : clip(count)) };
}
