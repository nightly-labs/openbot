import { createEffect, untrack } from "solid-js";

const USAGE_AUTO_REFRESH_MS = 5 * 60_000;
const USAGE_AUTO_REFRESH_CHECK_MS = 30_000;

export interface UsageRefreshPollOptions {
  target: () => string | null;
  refresh: (target: string) => void;
  refreshAtStart: boolean;
  refreshMs?: number;
  checkMs?: number;
}

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
