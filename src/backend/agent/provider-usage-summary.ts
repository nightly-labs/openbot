import type { AccountUsage, AccountUsageWindow } from "@openbot/contracts/ipc";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_WINDOW_MINUTES = 7 * 24 * 60;
const WEEK_WINDOW_TOLERANCE_MINUTES = 24 * 60;

function summarizeWindow(name: string, models: string[], window: AccountUsageWindow, now: number) {
  const remainingPercent = Math.min(100, Math.max(0, 100 - window.usedPercent));
  const isWeeklyWindow =
    window.windowDurationMins !== null &&
    Math.abs(window.windowDurationMins - WEEK_WINDOW_MINUTES) <= WEEK_WINDOW_TOLERANCE_MINUTES;
  const resetDue = window.resetsAt !== null && window.resetsAt * 1_000 <= now;
  const daysUntilReset = window.resetsAt === null ? null : Math.max(0, (window.resetsAt * 1_000 - now) / DAY_MS);
  const pace =
    isWeeklyWindow && !resetDue && daysUntilReset !== null && daysUntilReset > 0 && window.windowDurationMins !== null
      ? { daysUntilReset, windowDurationMins: window.windowDurationMins }
      : null;
  const expectedRemainingPercent = pace
    ? Math.min(100, (pace.daysUntilReset * 24 * 60 * 100) / pace.windowDurationMins)
    : null;

  return {
    name,
    models,
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    remainingPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
    isWeeklyWindow,
    resetDue,
    daysUntilReset,
    targetUsePercentPerDay: pace ? remainingPercent / pace.daysUntilReset : null,
    expectedRemainingPercent,
    paceGapPercent: expectedRemainingPercent === null ? null : remainingPercent - expectedRemainingPercent,
  };
}

export function summarizeProviderUsage(usage: AccountUsage, now = Date.now()) {
  return {
    checkedAt: new Date(now).toISOString(),
    unit: "percent",
    exactTokenCountsAvailable: false,
    accounts: usage.limits.map((limit) => {
      const windows = limit.groups?.length
        ? limit.groups
            .flatMap((group) => [
              ...(group.primary ? [summarizeWindow(group.name, group.models, group.primary, now)] : []),
              ...(group.secondary
                ? [summarizeWindow(`${group.name}:secondary`, group.models, group.secondary, now)]
                : []),
            ])
            .concat(limit.tertiary ? [summarizeWindow("tertiary", [], limit.tertiary, now)] : [])
        : [
            ...(limit.primary ? [summarizeWindow("primary", [], limit.primary, now)] : []),
            ...(limit.secondary ? [summarizeWindow("secondary", [], limit.secondary, now)] : []),
            ...(limit.tertiary ? [summarizeWindow("tertiary", [], limit.tertiary, now)] : []),
          ];
      return {
        provider: limit.id,
        accountId: limit.accountId ?? "default",
        ...(limit.readFailed ? { readFailed: true } : {}),
        ...(limit.sharedQuotaWith ? { sharedQuotaWith: limit.sharedQuotaWith } : {}),
        ...(limit.creditsAvailable === undefined ? {} : { creditsAvailable: limit.creditsAvailable }),
        windows,
      };
    }),
  };
}
