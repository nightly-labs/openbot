import { chunkMarkdown, FENCE } from "../messaging-chunks";

/** Slack cuts a message at 40,000 characters and folds long ones; this keeps each post readable. */
const SLACK_CHUNK_CHARACTERS = 3_900;

/**
 * Markdown as Slack `mrkdwn`. Content `&`, `<` and `>` are escaped, also in code, as Slack
 * requires. That also makes `<!channel>`, `<!here>` and `<!subteam^…>` inert: an answer cannot ping a
 * workspace or a group. With `userMentions`, a user mention `<@U…>` or `<@W…>` outside code and links
 * is made live again, so it pings that user. Only an answer or a post sets it: status text, such as
 * an approval's command, stays inert.
 */
export function slackMrkdwn(markdown: string, userMentions = false): string {
  const lines = escapeSlack(markdown).split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (line.trimStart().startsWith(FENCE)) {
        inFence = !inFence;
        return FENCE;
      }
      return inFence ? line : inlineMrkdwn(blockMrkdwn(line), userMentions);
    })
    .join("\n");
}

/** The users that a post of `markdown` pings: each user mention that `slackMrkdwn` makes live. */
export function slackPingedUsers(markdown: string): string[] {
  return [
    ...new Set(Array.from(slackMrkdwn(markdown, true).matchAll(/<@([UW][A-Z0-9]+)>/g), (match) => match[1] ?? "")),
  ];
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

function inlineMrkdwn(line: string, userMentions: boolean): string {
  // Code spans keep their text; everything else is converted between them.
  return line
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return part;
      const bold: string[] = [];
      const converted = part
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, a: string | undefined, b: string | undefined) => {
          bold.push(a ?? b ?? "");
          return `\uE001${bold.length - 1}\uE001`;
        })
        .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "_$1_")
        .replace(/~~(.+?)~~/g, "~$1~")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
        .replace(/\uE001(\d+)\uE001/g, (_match, index: string) => `*${bold[Number(index)]}*`);
      if (!userMentions) return converted;
      // Content `<` is escaped, so each `<…>` here is a link that this function made.
      return converted
        .split(/(<[^>]*>)/)
        .map((text) => (text.startsWith("<") ? text : text.replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, "<@$1>")))
        .join("");
    })
    .join("");
}

/** Splits `mrkdwn` into posts of at most `limit` characters (`chunkMarkdown`). */
export function slackChunks(text: string, limit = SLACK_CHUNK_CHARACTERS): string[] {
  return chunkMarkdown(text, limit);
}
