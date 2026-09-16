import { createHash } from "node:crypto";

/** Owns watcher text shaping. No database and no network. Pure on purpose. */

/** Below this kept length a read counts as thin: a shell, a block page, or an empty body. */
export const WATCHER_THIN_TEXT_LENGTH = 120;

/** One kept segment of page text. Keys are content-derived, so reorder alone never fires. */
export interface WatcherBlock {
  key: string;
  text: string;
  hash: string;
}

export function normalizeWatcherText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

const RELATIVE_AGE_PATTERN = /\b\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/gi;
const COUNT_PATTERN =
  /\b\d[\d,]*\s+(points?|views?|likes?|dislikes?|comments?|shares?|followers?|following|subscribers?|reads?|votes?)\b/gi;
const RANK_PREFIX_PATTERN = /(^|\s)\d{1,4}\.\s(?=[A-Z0-9£$€"“])/g;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?\b/g;
const WRITTEN_DATE_PATTERN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi;
const DAY_FIRST_DATE_PATTERN = /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
const WEEKDAY_DATE_PATTERN = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+\w+\s+\d{4}\b/gi;
const LEFTOVER_WEEKDAY_PATTERN = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*/gi;
const TIME_WITH_ZONE_PATTERN = /\b\d{1,2}:\d{2}(:\d{2})?\s*(UTC|GMT|[+-]\d{4})\b/g;
const BOILERPLATE_LINE_PATTERNS = [
  /we use cookies/i,
  /accept (all )?cookies/i,
  /cookie (policy|consent|settings|preferences)/i,
  /all rights reserved/i,
  /copyright ©? \d{4}/i,
];

/**
 * Drops volatile tokens that churn without meaning: relative ages, counts, ranks, dates, and
 * cookie boilerplate lines. Real content words stay untouched.
 */
export function filterWatcherNoise(normalized: string): string {
  const withoutTokens = normalized
    .replace(RELATIVE_AGE_PATTERN, " ")
    .replace(COUNT_PATTERN, " ")
    .replace(RANK_PREFIX_PATTERN, "$1")
    .replace(ISO_DATE_PATTERN, " ")
    .replace(WRITTEN_DATE_PATTERN, " ")
    .replace(WEEKDAY_DATE_PATTERN, " ")
    .replace(DAY_FIRST_DATE_PATTERN, " ")
    .replace(LEFTOVER_WEEKDAY_PATTERN, " ")
    .replace(TIME_WITH_ZONE_PATTERN, " ");
  const keptLines = withoutTokens
    .split(/(?<=[.!?…])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line)));
  return keptLines
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Splits kept text into content-keyed blocks. Reorder alone changes no key set, so a shuffled
 * list does not fire. Insertions and edits add or remove keys.
 */
export function splitWatcherBlocks(kept: string): WatcherBlock[] {
  const segments = kept
    .split(/(?<=[.!?…])\s+|\s+[|•·–—]\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 12);
  const blocks = segments.length > 0 ? segments : kept.trim() ? [kept.trim()] : [];
  return blocks.map((text) => {
    const hash = createHash("sha256").update(text, "utf8").digest("hex");
    return { key: hash.slice(0, 16), text, hash };
  });
}

/** Order-free state hash over the block set. Sorted, so reorder alone never fires. */
export function hashWatcherBlocks(blocks: WatcherBlock[]): string {
  const keys = blocks.map((block) => block.key).sort();
  return `v2:${createHash("sha256").update(keys.join("\n"), "utf8").digest("hex")}`;
}

export function hashWatcherState(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Thin when too short to judge: a JS shell, a block page, or an empty body. */
export function isThinWatcherText(kept: string): boolean {
  return kept.length < WATCHER_THIN_TEXT_LENGTH;
}

/**
 * Narrows kept text to a window around the stored text anchor. Content outside the window
 * cannot fire. Missing anchor falls back to the full text so a moved block degrades to weak
 * instead of going blind.
 */
export function scopeWatcherText(kept: string, textAnchor: string | undefined): { text: string; scoped: boolean } {
  if (!textAnchor || textAnchor.trim().length === 0) return { text: kept, scoped: false };
  const index = kept.toLowerCase().indexOf(textAnchor.trim().toLowerCase());
  if (index === -1) return { text: kept, scoped: false };
  const radius = 1500;
  const start = Math.max(0, index - radius);
  return { text: kept.slice(start, index + textAnchor.trim().length + radius).trim(), scoped: true };
}

/** Raw HTML markers of a client-rendered shell: the text read is the loader, not the page. */
export function looksLikeAppShell(rawHtml: string): boolean {
  return /__next_data__|__nuxt__|ng-version|id="root"|id="app"|just a moment|checking your browser|enable javascript|javascript is (required|disabled)/i.test(
    rawHtml.slice(0, 50_000),
  );
}

export function watcherTextMatches(text: string, textContains: string | undefined): boolean {
  if (!textContains || textContains.trim().length === 0) return true;
  return normalizeWatcherText(text).toLowerCase().includes(textContains.trim().toLowerCase());
}

/** Block diff with `-` removed and `+` added lines. Empty when the sets match. */
export function diffWatcherBlocks(before: WatcherBlock[], after: WatcherBlock[]): string {
  const beforeKeys = new Set(before.map((block) => block.key));
  const afterKeys = new Set(after.map((block) => block.key));
  const removed = before.filter((block) => !afterKeys.has(block.key));
  const added = after.filter((block) => !beforeKeys.has(block.key));
  const lines = [...removed.map((block) => `- ${block.text}`), ...added.map((block) => `+ ${block.text}`)];
  return truncateWatcherDiff(lines.join("\n"));
}

export function truncateWatcherDiff(diff: string, maximum = 4000): string {
  if (diff.length <= maximum) return diff;
  return `${diff.slice(0, maximum)}…`;
}

/** Run-local context block for a watcher-fired turn. Stored instruction stays clean. */
export function watcherMatchPrefix(watcherName: string, summary: string, diff: string): string {
  return [`--- watcher match ---`, `Watcher: ${watcherName}`, `Change: ${summary}`, diff].join("\n");
}
