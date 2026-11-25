import type { AccountUsageLimit, AccountUsageWindow } from "@openbot/contracts/ipc";

export interface PoolCandidate {
  accountId: string;
  reading: Pick<AccountUsageLimit, "primary" | "secondary"> | null;
}

const SHORT_WINDOW_MINUTES = 24 * 60;

function bufferPercent(window: AccountUsageWindow) {
  if (window.windowDurationMins === null) return 10;
  return window.windowDurationMins <= SHORT_WINDOW_MINUTES ? 15 : 5;
}

function usedNow(window: AccountUsageWindow, nowSeconds: number): number {
  return window.resetsAt !== null && window.resetsAt <= nowSeconds ? 0 : window.usedPercent;
}

function windowsOf(candidate: PoolCandidate): AccountUsageWindow[] {
  return [candidate.reading?.primary, candidate.reading?.secondary].filter(
    (window): window is AccountUsageWindow => window !== null && window !== undefined,
  );
}

function usable(candidate: PoolCandidate, nowSeconds: number): boolean {
  return windowsOf(candidate).every((window) => usedNow(window, nowSeconds) < 100 - bufferPercent(window));
}

function longestReset(candidate: PoolCandidate, nowSeconds: number): number | null {
  let longest: AccountUsageWindow | null = null;
  for (const window of windowsOf(candidate)) {
    if (window.resetsAt === null || window.resetsAt <= nowSeconds) continue;
    if (!longest || (window.windowDurationMins ?? 0) > (longest.windowDurationMins ?? 0)) longest = window;
  }
  return longest?.resetsAt ?? null;
}

const SAME_RESET_SECONDS = 10 * 60;

export function pickPoolAccount(
  candidates: readonly PoolCandidate[],
  current: string | null,
  nowSeconds: number,
  openOnly = false,
): string | null {
  if (candidates.length === 0) return null;
  const open = candidates.filter((candidate) => usable(candidate, nowSeconds));
  if (open.length === 0 && openOnly) return null;
  if (open.length === 0) {
    const mostLeft = (candidate: PoolCandidate) =>
      Math.max(0, ...windowsOf(candidate).map((window) => usedNow(window, nowSeconds)));
    return candidates.reduce((best, candidate) =>
      mostLeft(candidate) < mostLeft(best) ||
      (mostLeft(candidate) === mostLeft(best) && candidate.accountId === current)
        ? candidate
        : best,
    ).accountId;
  }
  const rank = (candidate: PoolCandidate) => longestReset(candidate, nowSeconds) ?? Number.POSITIVE_INFINITY;
  return open.reduce((best, candidate) => {
    const difference = rank(candidate) - rank(best);
    if (rank(candidate) === rank(best) || Math.abs(difference) < SAME_RESET_SECONDS)
      return candidate.accountId === current ? candidate : best;
    return difference < 0 ? candidate : best;
  }).accountId;
}
