import { chunkMarkdown, FENCE } from "../messaging-chunks";

/** WhatsApp takes 65,536 characters, but long posts read badly on a phone. */
export const WHATSAPP_TEXT_LIMIT = 4_000;

/** Splits an answer into WhatsApp posts, each in WhatsApp's own formatting. */
export function whatsAppChunks(markdown: string): string[] {
  return chunkMarkdown(markdown, WHATSAPP_TEXT_LIMIT).map(whatsAppText);
}

/**
 * Markdown in WhatsApp's formatting: `*bold*`, `_italic_`, `~strike~`, `` `code` `` and fenced blocks.
 * Headings become bold lines and links show their address after the text. Text in code stays as it is.
 */
export function whatsAppText(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith(FENCE)) {
      inFence = !inFence;
      out.push(line.trimStart().slice(0, FENCE.length));
      continue;
    }
    out.push(inFence ? line : inlineLine(line));
  }
  return out.join("\n");
}

function inlineLine(line: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.*)$/u.exec(line);
  const body = heading ? (heading[1] ?? "") : line;
  // Code spans keep their text; the rest is converted around them.
  const parts = body.split(/(`[^`]+`)/u);
  const converted = parts
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? part : inlineText(part)))
    .join("");
  const bullet = converted.replace(/^(\s*)[*+]\s+/u, "$1• ");
  return heading ? `*${bullet.trim()}*` : bullet;
}

function inlineText(text: string): string {
  return (
    text
      // Links: [text](https://…) → text (https://…).
      .replace(/!?\[([^\]]+)\]\((\S+?)\)/gu, (_match, label: string, url: string) =>
        label === url ? url : `${label} (${url})`,
      )
      // Bold first, through a private-use marker, so the italic rule does not read its stars.
      .replace(
        /\*\*(.+?)\*\*|__(.+?)__/gu,
        (_match, a: string | undefined, b: string | undefined) => `\uE00F${a ?? b}\uE00F`,
      )
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/gu, "$1_$2_")
      .replace(/~~(.+?)~~/gu, "~$1~")
      .replace(/\uE00F/gu, "*")
  );
}
