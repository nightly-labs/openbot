import { CHROME_EXTENSION_URL } from "./browser-extension";
import { isDynamicRecord, isString } from "./runtime-values";

export const X_AGENT_LISTING_ID = "openbot-curated-agent-x-desk";

export const X_EXTENSION_URL = CHROME_EXTENSION_URL;

export const X_PAGE_RULES_ROUTE = "/v1/browser-extension/x-rules";

export const X_PAGE_PARTS = [
  "composer",
  "replyButton",
  "dialog",
  "post",
  "focalPost",
  "postText",
  "postAuthor",
  "postTime",
  "postLink",
  "article",
  "media",
] as const;

export type XPagePart = (typeof X_PAGE_PARTS)[number];

export interface XPageRules {
  mention: string;
  selectors: Record<XPagePart, string[]>;
}

const SELECTORS_PER_PART = 12;
const SELECTOR_LENGTH = 300;

export const X_PAGE_RULES_DEFAULT: XPageRules = {
  mention: "openbot_",
  selectors: {
    composer: [
      '[data-testid="tweetTextarea_0"]',
      'textarea[aria-multiline="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ],
    replyButton: [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      'button[data-slot="xds-button"][class~="bg-btn-primary"]:not([aria-label])',
    ],
    dialog: ['[role="dialog"]'],
    post: ['article[data-testid="tweet"]', "article", "form > div:has(> div > [data-post-avatar])"],
    focalPost: ['article[data-testid="tweet"][tabindex="-1"]', '[data-navigation-stop][tabindex="-1"] > article'],
    postText: ['[data-testid="tweetText"]', 'div[dir="auto"][lang]:not(article article *)'],
    postAuthor: [
      '[data-testid="User-Name"]',
      'div:not(article article *):has(> span > a[href] > div[dir="auto"])',
      'div:not(article article *):has(> span > div[dir="auto"])',
    ],
    postTime: ["time[datetime]"],
    postLink: [
      'a[href*="/status/"]:has(time)',
      'a[data-base-ui-tooltip-trigger][href*="/status/"]:not(article article *)',
    ],
    article: [
      '[data-testid="twitterArticleRichTextView"]',
      '[data-testid="longformRichTextComponent"]',
      'div:has(> [data-article-part="title"])',
    ],
    media: ['[data-testid="tweetPhoto"] img', 'a[data-engagement-action="media"] img:not(article article *)'],
  },
};

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

export async function xPageRulesHash(rules: XPageRules): Promise<string> {
  const text = JSON.stringify({
    mention: rules.mention,
    selectors: Object.fromEntries(X_PAGE_PARTS.map((part) => [part, rules.selectors[part]])),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface XPost {
  authorName: string;
  handle: string;
  time: string;
  url: string;
  text: string;
  article: string;
  media: string[];
}

export interface XReplyPayload {
  message: string;
  pageUrl: string;
  posts: XPost[];
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
