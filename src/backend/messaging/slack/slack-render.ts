import { chunkMarkdown, FENCE } from "../messaging-chunks";

/** Slack cuts a message at 40,000 characters and folds long ones; this keeps each post readable. */
const SLACK_CHUNK_CHARACTERS = 3_900;

/**
 * Markdown as Slack `mrkdwn`. Content `&`, `<` and `>` are escaped, also in code, as Slack
 * requires. That also makes `<!channel>`, `<!here>` and `<!subteam^…>` inert: an answer cannot ping a
 * workspace or a group. Only a user mention `<@U…>` or `<@W…>` is made live again, so it pings that user.
 */
export function slackMrkdwn(markdown: string): string {
  const lines = escapeSlack(markdown).split("\n");
  let inFence = false;
  const mrkdwn = lines
    .map((line) => {
      if (line.trimStart().startsWith(FENCE)) {
        inFence = !inFence;
        return FENCE;
      }
      return inFence ? line : inlineMrkdwn(blockMrkdwn(line));
    })
    .join("\n");
  return mrkdwn.replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, "<@$1>");
}

function escapeSlack(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function blockMrkdwn(line: string): string {
  const quote = /^ {0,3}&gt; ?(.*)$/.exec(line);
  if (quote) return `> ${quote[1]}`;
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `**${heading[1]}**`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1]}• ${bullet[2]}`;
  return line;
}

function inlineMrkdwn(line: string): string {
  // Code spans keep their text; everything else is converted between them.
  return line
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return part;
      const bold: string[] = [];
      return part
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, a: string | undefined, b: string | undefined) => {
          bold.push(a ?? b ?? "");
          return `\uE001${bold.length - 1}\uE001`;
        })
        .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "_$1_")
        .replace(/~~(.+?)~~/g, "~$1~")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
        .replace(/\uE001(\d+)\uE001/g, (_match, index: string) => `*${bold[Number(index)]}*`);
    })
    .join("");
}

/** Splits `mrkdwn` into posts of at most `limit` characters (`chunkMarkdown`). */
export function slackChunks(text: string, limit = SLACK_CHUNK_CHARACTERS): string[] {
  return chunkMarkdown(text, limit);
}
