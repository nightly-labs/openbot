import { slackChunks } from "../slack/slack-render";

const TELEGRAM_CHUNK_CHARACTERS = 3_800;

const FENCE = "```";

export function telegramHtml(markdown: string, mentionName?: (userId: string) => string): string {
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
      quote.push(inlineHtml(quoted[1] ?? "", mentionName));
      continue;
    }
    flushQuote();
    out.push(blockHtml(line, mentionName));
  }
  flushQuote();
  if (fence) out.push(preHtml(fence, language));
  return out.join("\n");
}

export function telegramChunks(markdown: string): string[] {
  return slackChunks(markdown, TELEGRAM_CHUNK_CHARACTERS);
}

export function telegramPlainText(markdown: string): string {
  return inertMentions(markdown);
}

export function hasTelegramMention(markdown: string): boolean {
  let fence = false;
  return markdown.split("\n").some((line) => {
    if (line.trimStart().startsWith(FENCE)) {
      fence = !fence;
      return false;
    }
    return !fence && TELEGRAM_MENTION.test(line.replace(/`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)/gu, ""));
  });
}

function codeLanguage(fenceLine: string): string {
  return /^\s*```([\w+#.-]+)\s*$/u.exec(fenceLine)?.[1] ?? "";
}

function preHtml(lines: string[], language: string): string {
  const code = lines.join("\n");
  return language ? `<pre><code class="language-${language}">${code}</code></pre>` : `<pre>${code}</pre>`;
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function blockHtml(line: string, mentionName: ((userId: string) => string) | undefined): string {
  const heading = /^#{1,6}\s+(.*)$/u.exec(line);
  if (heading) return `<b>${inlineHtml(heading[1] ?? "", mentionName)}</b>`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/u.exec(line);
  if (bullet) return `${bullet[1]}• ${inlineHtml(bullet[2] ?? "", mentionName)}`;
  return inlineHtml(line, mentionName);
}

function inlineHtml(line: string, mentionName: ((userId: string) => string) | undefined): string {
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
      const mentioned = mentionName
        ? text.replace(/(?<![\w@])@([0-9]{5,20})\b/gu, (_match, userId: string) => {
            links.push(`<a href="tg://user?id=${userId}">${escapeHtml(mentionName(userId))}</a>`);
            return `\uE002${links.length - 1}\uE002`;
          })
        : inertMentions(text);
      return escapeHtml(mentioned)
        .replace(
          /\*\*(.+?)\*\*|__(.+?)__/gu,
          (_match, a: string | undefined, b: string | undefined) => `<b>${a ?? b}</b>`,
        )
        .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/gu, "<i>$1</i>")
        .replace(/(?<![\p{L}\p{N}\p{M}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}\p{M}_])/gu, "<i>$1</i>")
        .replace(/~~(.+?)~~/gu, "<s>$1</s>")
        .replace(/(\d+)/gu, (_match, index: string) => links[Number(index)] ?? "");
    })
    .join("");
}

const TELEGRAM_MENTION = /(?<![\w@])@(?:[0-9]{5,20}\b|[A-Za-z][A-Za-z0-9_]{4,31}\b)/u;

function inertMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9_])/gu, "@⁠");
}
