import { slackChunks } from "../slack/slack-render";

/** Telegram refuses a message over 4,096 characters of text. This leaves space for the markup it removes. */
const TELEGRAM_CHUNK_CHARACTERS = 3_800;

const FENCE = "```";

/**
 * Markdown as Telegram HTML (`parse_mode: "HTML"`). `&`, `<` and `>` are escaped everywhere, so the
 * text cannot add markup. `@name` gets a word joiner after `@`, so an answer cannot mention or notify
 * anyone, as in Slack. A link keeps only an `http` or `https` address.
 */
export function telegramHtml(markdown: string): string {
  const out: string[] = [];
  let fence: string[] | null = null;
  let language = "";
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("\n")}</blockquote>`);
    quote = [];
  };
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith(FENCE)) {
      if (fence) {
        out.push(preHtml(fence, language));
        fence = null;
      } else {
        flushQuote();
        fence = [];
        language = codeLanguage(line);
      }
      continue;
    }
    if (fence) {
      fence.push(escapeHtml(line));
      continue;
    }
    const quoted = /^>\s?(.*)$/u.exec(line);
    if (quoted) {
      quote.push(inlineHtml(quoted[1] ?? ""));
      continue;
    }
    flushQuote();
    out.push(blockHtml(line));
  }
  flushQuote();
  if (fence) out.push(preHtml(fence, language));
  return out.join("\n");
}

/** Markdown in posts that fit one Telegram message each. A cut code block is closed and opened again. */
export function telegramChunks(markdown: string): string[] {
  return slackChunks(markdown, TELEGRAM_CHUNK_CHARACTERS);
}

/** An answer as plain text, for a post that Telegram refused as HTML. */
export function telegramPlainText(markdown: string): string {
  return inertMentions(markdown);
}

/** The language after an opening fence, such as `python` in "```python". Other text gives none. */
function codeLanguage(fenceLine: string): string {
  return /^\s*```([\w+#.-]+)\s*$/u.exec(fenceLine)?.[1] ?? "";
}

/** A code block. Telegram colors the code when it gets a language. */
function preHtml(lines: string[], language: string): string {
  const code = lines.join("\n");
  return language ? `<pre><code class="language-${language}">${code}</code></pre>` : `<pre>${code}</pre>`;
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function blockHtml(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/u.exec(line);
  if (heading) return `<b>${inlineHtml(heading[1] ?? "")}</b>`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/u.exec(line);
  if (bullet) return `${bullet[1]}• ${inlineHtml(bullet[2] ?? "")}`;
  return inlineHtml(line);
}

function inlineHtml(line: string): string {
  // Code spans keep their text; everything else is converted between them.
  return line
    .split(/(`[^`]+`)/u)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      const links: string[] = [];
      const text = part.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, (_match, label: string, url: string) => {
        links.push(`<a href="${escapeHtml(url).replaceAll('"', "&quot;")}">${escapeHtml(inertMentions(label))}</a>`);
        return `${links.length - 1}`;
      });
      return escapeHtml(inertMentions(text))
        .replace(
          /\*\*(.+?)\*\*|__(.+?)__/gu,
          (_match, a: string | undefined, b: string | undefined) => `<b>${a ?? b}</b>`,
        )
        .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/gu, "<i>$1</i>")
        .replace(/(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/gu, "<i>$1</i>")
        .replace(/~~(.+?)~~/gu, "<s>$1</s>")
        .replace(/(\d+)/gu, (_match, index: string) => links[Number(index)] ?? "");
    })
    .join("");
}

/** `@name` with a word joiner after `@`: Telegram then sees no mention. */
function inertMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9_])/gu, "@⁠");
}
