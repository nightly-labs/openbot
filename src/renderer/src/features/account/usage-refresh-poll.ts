import { createEffect, untrack } from "solid-js";

/** How old a reading may get before it is fetched again. The rail rings always show the plan limits. */
const USAGE_AUTO_REFRESH_MS = 5 * 60_000;
/** The poll asks more often than it refreshes, and each tick compares the age of the reading. */
const USAGE_AUTO_REFRESH_CHECK_MS = 30_000;

export interface UsageRefreshPollOptions {
  /** The usage target, or null while no reading can be taken. A new target starts the poll again. */
  target: () => string | null;
  refresh: (target: string) => void;
  /**
   * Whether a new target is read at once. False when a reading for the target is already on its way,
   * so its age starts now.
   */
  refreshAtStart: boolean;
  /** How old a reading may get before it is fetched again. The default suits the plan limits. */
  refreshMs?: number;
  /** How often the poll compares the age of the reading. Keep it well below `refreshMs`. */
  checkMs?: number;
}

/**
 * Keeps a reading of the target fresh: the plan limits, on desktop and on the web, and the disk of the
 * sidebar storage card, and the machine use in the Usage header. A hidden window or tab does not poll; coming back to it refreshes at once when
 * the interval has passed.
 */
export function createUsageRefreshPoll(options: UsageRefreshPollOptions) {
  const refreshMs = options.refreshMs ?? USAGE_AUTO_REFRESH_MS;
  const checkMs = options.checkMs ?? USAGE_AUTO_REFRESH_CHECK_MS;
  let lastRefreshAt = 0;

  function refresh(target: string) {
    lastRefreshAt = Date.now();
    options.refresh(target);
  }

  createEffect(options.target, (target) => {
    if (!target) return;
    const targetKey = target;
    if (options.refreshAtStart) untrack(() => refresh(targetKey));
    else lastRefreshAt = Date.now();
    function refreshWhenDue() {
      if (document.hidden || Date.now() - lastRefreshAt < refreshMs) return;
      refresh(targetKey);
    }
    const timer = window.setInterval(refreshWhenDue, checkMs);
    document.addEventListener("visibilitychange", refreshWhenDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenDue);
    };
  });
}
