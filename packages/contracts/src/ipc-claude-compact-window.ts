/**
 * The size at which Claude Code compacts the chats of a server's agents (`claude-compact-window-v1`),
 * as the desktop main process, the preload, the browser client and the mobile app read it. Claude
 * Code sums up the older turns of a chat when its context reaches this many tokens. A model with a
 * smaller context window compacts at its own limit. Automatic compaction stays on.
 */

import { isDynamicRecord } from "./runtime-values";

/** The smallest and the largest size that Claude Code accepts. */
export const CLAUDE_COMPACT_WINDOW_MIN_TOKENS = 100_000;
export const CLAUDE_COMPACT_WINDOW_MAX_TOKENS = 1_000_000;

/** The sizes that Settings offers. `null` is first: it leaves Claude Code's own size for each model. */
export const CLAUDE_COMPACT_WINDOW_CHOICES = [
  null,
  100_000,
  150_000,
  200_000,
  300_000,
  400_000,
  600_000,
  800_000,
  1_000_000,
] as const;

export interface ClaudeCompactWindowSetting {
  /** The size in tokens, or `null` for Claude Code's own size for each model. */
  tokens: number | null;
}

/** Claude Code's own size, as before the setting. An upgrade keeps it, because no file exists yet. */
export const DEFAULT_CLAUDE_COMPACT_WINDOW: ClaudeCompactWindowSetting = { tokens: null };

/** A whole number of tokens that Claude Code accepts, or `null` for its own size. */
export function isClaudeCompactWindowTokens(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= CLAUDE_COMPACT_WINDOW_MIN_TOKENS &&
      value <= CLAUDE_COMPACT_WINDOW_MAX_TOKENS)
  );
}

export function decodeClaudeCompactWindowSetting(value: unknown): ClaudeCompactWindowSetting {
  if (!isDynamicRecord(value) || !isClaudeCompactWindowTokens(value.tokens))
    throw new Error("Invalid Claude compaction size.");
  return { tokens: value.tokens };
}
