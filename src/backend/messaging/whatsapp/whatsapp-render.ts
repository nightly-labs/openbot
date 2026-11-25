import { chunkMarkdown, FENCE } from "../messaging-chunks";

export const WHATSAPP_TEXT_LIMIT = 4_000;

export function whatsAppChunks(markdown: string): string[] {
  return chunkMarkdown(markdown, WHATSAPP_TEXT_LIMIT).map(whatsAppText);
}

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
  const parts = body.split(/(`[^`]+`)/u);
  const converted = parts
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? part : inlineText(part)))
    .join("");
  const bullet = converted.replace(/^(\s*)[*+]\s+/u, "$1• ");
  return heading ? `*${bullet.trim()}*` : bullet;
}

function inlineText(text: string): string {
  return text
    .replace(/!?\[([^\]]+)\]\((\S+?)\)/gu, (_match, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(
      /\*\*(.+?)\*\*|__(.+?)__/gu,
      (_match, a: string | undefined, b: string | undefined) => `\uE00F${a ?? b}\uE00F`,
    )
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/gu, "$1_$2_")
    .replace(/~~(.+?)~~/gu, "~$1~")
    .replace(/\uE00F/gu, "*");
}
