import { blockChatMath, chatMathBlockStart, chatMathStart, inlineChatMath } from "@openbot/contracts/chat-math";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { replaceEqualDeep } from "@tanstack/react-query";
import { Marked, type Token, type TokensList } from "marked";

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
        if (math) return { type: "blockMath", raw: math.raw, text: math.tex, display: true };
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start: chatMathStart,
      tokenizer(source) {
        const math = inlineChatMath(source);
        if (math) return { type: "inlineMath", raw: math.raw, text: math.tex, display: math.display };
      },
    },
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
    {
      name: "chatQuote",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        // The phone cannot open the quoted passage, so a quote reads as its text in quotation marks.
        if (reference?.start === 0 && reference.kind === "quote")
          return { type: "text", raw: source.slice(0, reference.end), text: `“${reference.name}”` };
      },
    },
    {
      name: "skillReference",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        // A skill or an app that a message names, such as a Try from the Marketplace, draws as a chip.
        if (reference?.start === 0 && (reference.kind === "skill" || reference.kind === "mcp"))
          return { type: "skillMention", raw: source.slice(0, reference.end) };
      },
    },
  ],
});

function parseChatMarkdown(body: string): TokensList {
  return markdown.lexer(body);
}

const MAX_STREAMING_BODIES = 8;
const REPARSED_BLOCKS = 2;
const ENDED_BY_BLANK_LINE = new Set(["paragraph", "heading", "hr", "table", "blockquote", "html", "code", "blockMath"]);
const LINK_DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;
const INLINE_STATE_TAG = /<\/?(?:a|pre|code|kbd|script)[\s>]/i;
const streamingBodies: { body: string; tokens: TokensList }[] = [];

function rawLength(tokens: readonly Token[]): number {
  return tokens.reduce((length, token) => length + token.raw.length, 0);
}

/**
 * The tokens that text added at the end cannot change: those before a blank line that ends its
 * block, with at least the last two blocks after it. A list or indented code goes on after a blank line.
 */
function settledLength(tokens: readonly Token[]): number {
  let blocks = 0;
  for (let index = tokens.length - 1; index > 0; index -= 1) {
    if (tokens[index]?.type !== "space") {
      blocks += 1;
      continue;
    }
    const before = tokens[index - 1];
    if (
      blocks >= REPARSED_BLOCKS &&
      before &&
      ENDED_BY_BLANK_LINE.has(before.type) &&
      !(before.type === "code" && before.codeBlockStyle === "indented")
    )
      return index + 1;
  }
  return 0;
}

/**
 * The tokens of a reply that still streams. A chunk adds text at the end, so the settled blocks
 * keep their tokens and only the rest is parsed again. The lexer reads link definitions
 * and the start of a math block in the whole body, and an inline link or raw HTML tag sets state
 * that the next blocks read, so a body with one of them is parsed in full.
 */
export function parseStreamingChatMarkdown(body: string): TokensList {
  let index = -1;
  for (const [candidate, entry] of streamingBodies.entries()) {
    if (body.startsWith(entry.body) && (index < 0 || entry.body.length > (streamingBodies[index]?.body.length ?? 0)))
      index = candidate;
  }
  const previous = index >= 0 ? streamingBodies.splice(index, 1)[0] : undefined;
  const tokens = previous ? shareUnchanged(previous.tokens, continueParse(body, previous)) : parseChatMarkdown(body);
  if (streamingBodies.length >= MAX_STREAMING_BODIES) streamingBodies.shift();
  streamingBodies.push({ body, tokens });
  return tokens;
}

function shareUnchanged(previous: TokensList, tokens: TokensList): TokensList {
  if (tokens === previous) return tokens;
  return Object.assign(
    tokens.map((token, index) => replaceEqualDeep(previous[index], token)),
    { links: tokens.links },
  );
}

function continueParse(body: string, previous: { body: string; tokens: TokensList }): TokensList {
  if (body === previous.body) return previous.tokens;
  if (
    body.includes("\r") ||
    LINK_DEFINITION.test(body) ||
    chatMathBlockStart(body) !== undefined ||
    rawLength(previous.tokens) !== previous.body.length
  )
    return parseChatMarkdown(body);
  const stable = previous.tokens.slice(0, settledLength(previous.tokens));
  if (stable.some((token) => INLINE_STATE_TAG.test(token.raw))) return parseChatMarkdown(body);
  const rest = parseChatMarkdown(body.slice(rawLength(stable)));
  return Object.assign([...stable, ...rest], { links: rest.links });
}

const MAX_CACHED_BODIES = 300;
const parsedBodies = new Map<string, ReturnType<typeof parseChatMarkdown>>();

/**
 * The tokens of a finished message, parsed once for the app run rather than each time its chat
 * opens. The renderers only read the tokens. A streaming reply changes on each chunk, so it uses
 * `parseStreamingChatMarkdown` and does not fill the cache.
 */
export function parseFinishedChatMarkdown(body: string) {
  const cached = parsedBodies.get(body);
  if (cached) {
    parsedBodies.delete(body);
    parsedBodies.set(body, cached);
    return cached;
  }
  const tokens = parseChatMarkdown(body);
  const oldest = parsedBodies.keys().next().value;
  if (parsedBodies.size >= MAX_CACHED_BODIES && oldest !== undefined) parsedBodies.delete(oldest);
  parsedBodies.set(body, tokens);
  return tokens;
}
