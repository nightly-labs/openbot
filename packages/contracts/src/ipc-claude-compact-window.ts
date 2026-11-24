import { isDynamicRecord } from "./runtime-values";

export const CLAUDE_COMPACT_WINDOW_MIN_TOKENS = 100_000;
export const CLAUDE_COMPACT_WINDOW_MAX_TOKENS = 1_000_000;

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

export function claudeCompactWindowSizes(saved: number | null): (number | null)[] {
  const sizes = new Set<number>();
  for (const size of [...CLAUDE_COMPACT_WINDOW_CHOICES, saved]) if (size !== null) sizes.add(size);
  return [null, ...[...sizes].sort((a, b) => a - b)];
}

export interface ClaudeCompactWindowSetting {
  tokens: number | null;
}

export const DEFAULT_CLAUDE_COMPACT_WINDOW: ClaudeCompactWindowSetting = { tokens: null };

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
