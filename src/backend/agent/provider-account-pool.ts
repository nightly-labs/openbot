import type { AccountUsageLimit, AccountUsageWindow } from "@openbot/contracts/ipc";

/** One account that the pool can use, with its last usage reading for the agent's model. */
export interface PoolCandidate {
  accountId: string;
  /** The windows of the reading for the agent's model, or null before a reading. */
  reading: Pick<AccountUsageLimit, "primary" | "secondary"> | null;
}

/** The longest window that counts as a short one, such as a five-hour window: one day. */
const SHORT_WINDOW_MINUTES = 24 * 60;

/**
 * The percent a window keeps free before the pool leaves its account. A reading is up to some
 * minutes old and one turn can use a large part of a short window, so a short window keeps more
 * free. A window with no duration keeps the mean of the two.
 */
function bufferPercent(window: AccountUsageWindow) {
  if (window.windowDurationMins === null) return 10;
  return window.windowDurationMins <= SHORT_WINDOW_MINUTES ? 15 : 5;
}

/** The percent used now: a window whose reset is past is empty, until the next reading. */
function usedNow(window: AccountUsageWindow, nowSeconds: number): number {
  return window.resetsAt !== null && window.resetsAt <= nowSeconds ? 0 : window.usedPercent;
}

function windowsOf(candidate: PoolCandidate): AccountUsageWindow[] {
  return [candidate.reading?.primary, candidate.reading?.secondary].filter(
    (window): window is AccountUsageWindow => window !== null && window !== undefined,
  );
}

/** True when each window of the reading keeps its buffer free. An account with no reading is usable. */
function usable(candidate: PoolCandidate, nowSeconds: number): boolean {
  return windowsOf(candidate).every((window) => usedNow(window, nowSeconds) < 100 - bufferPercent(window));
}

/**
 * When the longest window of the account resets, in epoch seconds: the capacity that is lost first
 * if it is not used. A plan with only a five-hour window resets soon and is used first. Null when the
 * reading names no reset.
 */
function longestReset(candidate: PoolCandidate, nowSeconds: number): number | null {
  let longest: AccountUsageWindow | null = null;
  for (const window of windowsOf(candidate)) {
    if (window.resetsAt === null || window.resetsAt <= nowSeconds) continue;
    if (!longest || (window.windowDurationMins ?? 0) > (longest.windowDurationMins ?? 0)) longest = window;
  }
  return longest?.resetsAt ?? null;
}

/** Two resets closer than this are the same: the pool then stays on its account. */
const SAME_RESET_SECONDS = 10 * 60;

/**
 * The account that the pool uses next. The pool uses one account until a window nears its limit,
 * then the next one, and does not spread work over the accounts: of the accounts that keep their
 * buffer, the one whose longest window resets first, because its unused capacity is lost first. An
 * account with no reading comes after the accounts with one. When no account keeps its buffer, the
 * one with the most capacity left is used, so the work stops only at a real limit. `candidates` are
 * in the order of the account list, and only accounts that are ready and not at a limit.
 */
export function pickPoolAccount(
  candidates: readonly PoolCandidate[],
  current: string | null,
  nowSeconds: number,
): string | null {
  if (candidates.length === 0) return null;
  const open = candidates.filter((candidate) => usable(candidate, nowSeconds));
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
