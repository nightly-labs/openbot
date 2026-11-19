import {
  blockChatMath,
  chatMathBlockInterrupts,
  chatMathBlockStart,
  chatMathStart,
  inlineChatMath,
} from "@openbot/contracts/chat-math";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { replaceEqualDeep } from "@tanstack/react-query";
import { Marked, type Token, type TokensList } from "marked";

const markdown = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    lheading(source) {
      const heading = this.rules.block.lheading.exec(source);
      return heading && chatMathBlockInterrupts(source, heading[0].length) ? undefined : false;
    },
  },
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
        if (reference?.start === 0 && reference.kind === "quote")
          return { type: "text", raw: source.slice(0, reference.end), text: `“${reference.name}”` };
        if (reference?.start === 0 && reference.kind === "thread")
          return { type: "text", raw: source.slice(0, reference.end), text: reference.name };
      },
    },
    {
      name: "skillReference",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start === 0 && (reference.kind === "skill" || reference.kind === "mcp"))
          return { type: "skillMention", raw: source.slice(0, reference.end) };
      },
    },
    {
      name: "tabReference",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start === 0 && reference.kind === "tab")
          return { type: "tabMention", raw: source.slice(0, reference.end) };
      },
    },
  ],
});

function parseChatMarkdown(body: string): TokensList {
  return markdown.lexer(body);
}

export function parseChatMarkdownDocument(body: string): TokensList {
  return parseChatMarkdown(body);
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

export function parseInlineChatMarkdown(body: string): Token[] {
  const tokens = new markdown.Lexer(markdown.defaults).inlineTokens(body);
  return [{ type: "paragraph", raw: body, text: body, tokens }];
}

export function walkChatMarkdown(tokens: Token[], visit: (token: Token) => void): void {
  void markdown.walkTokens(tokens, visit);
}
