// The browser extension on X (x.com). Shared by the extension and the account service.
//
// The extension finds the parts of an X page with CSS selectors, never with code from the network. X
// changes its page often, and a store review of a new extension takes days, so the account service
// serves newer selectors at `X_PAGE_RULES_ROUTE`. The extension keeps the newest valid copy and tries
// its selectors first, then the selectors that it was built with. The hash names one set of rules: the
// extension sends the hash that it has, and the service sends rules only when its own hash is different.
import { isDynamicRecord, isString } from "./runtime-values";

/** The Marketplace listing of the agent that takes posts from X (`marketplace/production-catalog`). */
export const X_AGENT_LISTING_ID = "openbot-curated-agent-x-desk";

/** The account service route that answers the current rules: `?hash=<hex>` → `{ hash, rules | null }`. */
export const X_PAGE_RULES_ROUTE = "/v1/browser-extension/x-rules";

/** The parts of an X page. Each is a list of CSS selectors; the first that matches wins. */
export const X_PAGE_PARTS = [
  /** The text box of a reply. */
  "composer",
  /** The button that posts that reply. */
  "replyButton",
  /** The reply window that shows the post being answered. */
  "dialog",
  /** One post. */
  "post",
  /** The post of a post page, among the posts above and below it. */
  "focalPost",
  /** In a post: its text, its author block (name and @handle), its time, the link to it, an X Article body, its pictures. */
  "postText",
  "postAuthor",
  "postTime",
  "postLink",
  "article",
  "media",
] as const;

export type XPagePart = (typeof X_PAGE_PARTS)[number];

export interface XPageRules {
  /** The handle that arms the reply button, without `@`, in lower case. */
  mention: string;
  selectors: Record<XPagePart, string[]>;
}

const SELECTORS_PER_PART = 12;
const SELECTOR_LENGTH = 300;

/** The rules that the extension is built with. A newer copy from the account service goes first. */
export const X_PAGE_RULES_DEFAULT: XPageRules = {
  mention: "openbot_",
  selectors: {
    composer: ['[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
    replyButton: ['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'],
    dialog: ['[role="dialog"]'],
    post: ['article[data-testid="tweet"]', "article"],
    focalPost: ['article[data-testid="tweet"][tabindex="-1"]'],
    postText: ['[data-testid="tweetText"]'],
    postAuthor: ['[data-testid="User-Name"]'],
    postTime: ["time[datetime]"],
    postLink: ['a[href*="/status/"]:has(time)'],
    article: ['[data-testid="twitterArticleRichTextView"]', '[data-testid="longformRichTextComponent"]'],
    media: ['[data-testid="tweetPhoto"] img'],
  },
};

/** Rules from the network or from storage. Null when one part is missing or too long. */
export function decodeXPageRules(value: unknown): XPageRules | null {
  if (!isDynamicRecord(value) || !isString(value.mention) || !/^[a-z0-9_]{1,15}$/u.test(value.mention)) return null;
  const selectors = value.selectors;
  if (!isDynamicRecord(selectors)) return null;
  const parts = new Map<XPagePart, string[]>();
  for (const part of X_PAGE_PARTS) {
    const list = selectors[part];
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > SELECTORS_PER_PART ||
      !list.every((selector) => isString(selector) && selector.length > 0 && selector.length <= SELECTOR_LENGTH)
    )
      return null;
    parts.set(part, list.filter(isString));
  }
  const part = (name: XPagePart) => parts.get(name) ?? [];
  return {
    mention: value.mention,
    selectors: {
      composer: part("composer"),
      replyButton: part("replyButton"),
      dialog: part("dialog"),
      post: part("post"),
      focalPost: part("focalPost"),
      postText: part("postText"),
      postAuthor: part("postAuthor"),
      postTime: part("postTime"),
      postLink: part("postLink"),
      article: part("article"),
      media: part("media"),
    },
  };
}

/** The SHA-256 of the rules in a fixed key order, as lower-case hex. Works in a worker, a page and Bun. */
export async function xPageRulesHash(rules: XPageRules): Promise<string> {
  const text = JSON.stringify({
    mention: rules.mention,
    selectors: Object.fromEntries(X_PAGE_PARTS.map((part) => [part, rules.selectors[part]])),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One post as the extension reads it from the page. */
export interface XPost {
  authorName: string;
  /** With `@`, or empty when the page does not show it. */
  handle: string;
  /** ISO time, or empty. */
  time: string;
  url: string;
  text: string;
  /** The body of an X Article, or empty. */
  article: string;
  media: string[];
}

/** What the extension sends to the X agent: the user's words and the post with its thread, no replies. */
export interface XReplyPayload {
  message: string;
  pageUrl: string;
  posts: XPost[];
  /** The index in `posts` of the post that the user answers. */
  replyTo: number;
}

export const X_PAYLOAD_LIMITS = {
  message: 2_000,
  posts: 25,
  text: 25_000,
  url: 2_000,
  name: 200,
  media: 8,
} as const;

const text = (value: unknown, limit: number): value is string => isString(value) && value.length <= limit;
const xUrl = (value: unknown): value is string => {
  if (!text(value, X_PAYLOAD_LIMITS.url)) return false;
  if (value === "") return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

function decodeXPost(value: unknown): XPost | null {
  if (!isDynamicRecord(value)) return null;
  const { authorName, handle, time, url, article, media } = value;
  if (
    !text(authorName, X_PAYLOAD_LIMITS.name) ||
    !text(handle, X_PAYLOAD_LIMITS.name) ||
    !text(time, X_PAYLOAD_LIMITS.name) ||
    !xUrl(url) ||
    !text(value.text, X_PAYLOAD_LIMITS.text) ||
    !text(article, X_PAYLOAD_LIMITS.text) ||
    !Array.isArray(media) ||
    media.length > X_PAYLOAD_LIMITS.media ||
    !media.every(xUrl)
  )
    return null;
  return { authorName, handle, time, url, text: value.text, article, media: [...media] };
}

/** The payload that a content script sent. A page of X is not trusted, so every part is checked. */
export function decodeXReplyPayload(value: unknown): XReplyPayload | null {
  if (!isDynamicRecord(value) || !text(value.message, X_PAYLOAD_LIMITS.message) || !xUrl(value.pageUrl)) return null;
  const { posts, replyTo } = value;
  if (!Array.isArray(posts) || posts.length === 0 || posts.length > X_PAYLOAD_LIMITS.posts) return null;
  const decoded = posts.map(decodeXPost);
  if (!decoded.every((post): post is XPost => post !== null)) return null;
  if (typeof replyTo !== "number" || !Number.isInteger(replyTo) || replyTo < 0 || replyTo >= decoded.length)
    return null;
  return { message: value.message, pageUrl: value.pageUrl, posts: decoded, replyTo };
}
