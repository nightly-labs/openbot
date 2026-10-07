const TELEGRAM_MESSAGE_LIMIT = 4096;
const FENCE = "```";

/** Splits text into chunks that fit into Telegram message length limit (4096). */
export function telegramChunks(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const reserve = FENCE.length + 1;
  const chunks: string[] = [];
  let current = "";
  let inFence = false;
  const flush = () => {
    if (!current.trim()) return;
    chunks.push(inFence ? `${current}\n${FENCE}` : current);
    current = inFence ? FENCE : "";
  };
  for (const line of text.split("\n")) {
    const pieces = line.length > limit - reserve * 2 ? hardSplit(line, limit - reserve * 2) : [line];
    for (const piece of pieces) {
      const next = current ? `${current}\n${piece}` : piece;
      if (next.length + (inFence ? reserve : 0) > limit) {
        flush();
        current = current ? `${current}\n${piece}` : piece;
      } else current = next;
    }
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence;
  }
  if (current.trim() && current !== FENCE) chunks.push(current);
  return chunks.length ? chunks : [""];
}

function hardSplit(line: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < line.length; index += size) parts.push(line.slice(index, index + size));
  return parts;
}

/** Escapes HTML characters for Telegram HTML parse_mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts markdown text into Telegram HTML tags (<b>, <i>, <code>, <pre>, <a href="...">).
 */
export function telegramHtml(markdown: string): string {
  // Extract and preserve code blocks first
  const codeBlocks: string[] = [];
  let html = markdown.replace(/```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g, (_match, lang, code) => {
    const token = `\uE001CODEBLOCK_${codeBlocks.length}\uE001`;
    const classAttr = lang ? ` class="language-${lang}"` : "";
    codeBlocks.push(`<pre><code${classAttr}>${escapeHtml(code.trimEnd())}</code></pre>`);
    return token;
  });

  // Extract and preserve inline code
  const inlineCode: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\uE002INLINECODE_${inlineCode.length}\uE002`;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  // Escape raw HTML in text
  html = escapeHtml(html);

  // Markdown links: [text](url) -> <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, text, url) => {
    return `<a href="${url}">${text}</a>`;
  });

  // Bold: **text** or __text__ -> <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/__([^_]+)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ -> <i>text</i>
  html = html.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  html = html.replace(/(^|[\s.,!?;:()[\]])_([^_]+)_(?=[\s.,!?;:()[\]]|$)/g, "$1<i>$2</i>");

  // Strikethrough: ~~text~~ or ~text~ -> <s>text</s>
  html = html.replace(/~{1,2}([^~]+)~{1,2}/g, "<s>$1</s>");

  // Restore inline code
  html = html.replace(/\uE002INLINECODE_(\d+)\uE002/g, (_match, index) => {
    return inlineCode[Number(index)] ?? "";
  });

  // Restore code blocks
  html = html.replace(/\uE001CODEBLOCK_(\d+)\uE001/g, (_match, index) => {
    return codeBlocks[Number(index)] ?? "";
  });

  return html;
}

/** Removes leading / command or @bot_username mentions from message text. */
export function plainText(text: string, botUsername?: string): string {
  let cleaned = text.trim();
  if (botUsername) {
    const raw = botUsername.startsWith("@") ? botUsername.slice(1) : botUsername;
    const mentionRegex = new RegExp(`@${raw}\\b`, "gi");
    cleaned = cleaned
      .replace(mentionRegex, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return cleaned;
}
