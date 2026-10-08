import type {
  AccountUsage,
  AccountUsageCredits,
  AccountUsageLimit,
  AccountUsageNamedWindow,
  AccountUsageWindow,
} from "@openbot/contracts/ipc";
import { isNumber } from "@openbot/contracts/runtime-values";
import type {
  AccountRateLimitNamedWindowResult,
  AccountRateLimitResult,
  AccountRateLimitsReadResult,
  AccountRateLimitWindowResult,
} from "../protocol";

/** The contract keeps at most this many windows for one provider. */
const MAX_USAGE_WINDOWS = 32;

export function normalizeAccountUsage(rateLimits: AccountRateLimitsReadResult | null, model?: string): AccountUsage {
  const entries = rateLimits?.rateLimitsByLimitId
    ? Object.entries(rateLimits.rateLimitsByLimitId).filter((entry): entry is [string, AccountRateLimitResult] =>
        Boolean(entry[1]),
      )
    : [];
  const fallback: [string, AccountRateLimitResult] | null = rateLimits?.rateLimits
    ? [rateLimits.rateLimits.limitId ?? "codex", rateLimits.rateLimits]
    : null;
  // No model means the dock's account-wide reading: one bucket per provider, not every
  // Codex model window mixed into the same unlabeled list. The other buckets go into its `windows`,
  // each with its model name.
  if (!model && fallback) {
    const limit = normalizeAccountLimit(fallback[0], fallback[1]);
    const others = entries.filter(([id, entry]) => (entry.limitId ?? id) !== limit.id);
    if (others.length > 0) {
      limit.windows = [
        ...(limit.windows ?? []),
        ...others.flatMap(([id, entry]) => modelBucketWindows(id, entry)),
      ].slice(0, MAX_USAGE_WINDOWS);
    }
    return { limits: [limit] };
  }
  const selectedEntries = model ? selectModelRateLimits(entries, model, fallback) : entries;
  const limits = selectedEntries.map(([id, limit]) => normalizeAccountLimit(id, limit));

  return { limits };
}

function selectModelRateLimits(
  entries: Array<[string, AccountRateLimitResult]>,
  model: string,
  fallback: [string, AccountRateLimitResult] | null,
): Array<[string, AccountRateLimitResult]> {
  const normalizedModel = model.trim().toLowerCase();
  const modelSpecific = entries.filter(([, limit]) =>
    [limit.limitName, limit.normalModelSlug].some((candidate) => candidate?.trim().toLowerCase() === normalizedModel),
  );
  if (modelSpecific.length > 0) return modelSpecific;
  if (fallback) return [fallback];
  return entries.filter(([id, limit]) => id === "codex" || limit.limitId === "codex");
}

function normalizeAccountLimit(id: string, limit: AccountRateLimitResult): AccountUsageLimit {
  const primary = normalizeUsageWindow(limit.primary);
  const secondary = normalizeUsageWindow(limit.secondary);
  const windows = limit.windows
    ? limit.windows.flatMap((window) => namedWindow(window))
    : [primary, secondary].flatMap((window) => (window ? [{ ...window, kind: "window" as const, label: null }] : []));
  const credits = normalizeCredits(limit.credits);
  return {
    id: limit.limitId ?? id,
    primary,
    secondary,
    ...(windows.length > 0 ? { windows: windows.slice(0, MAX_USAGE_WINDOWS) } : {}),
    ...(credits ? { credits: [credits] } : {}),
  };
}

/** A Codex model bucket: each of its windows, named after the model. */
function modelBucketWindows(id: string, limit: AccountRateLimitResult): AccountUsageNamedWindow[] {
  const label = limit.limitName?.trim() || limit.normalModelSlug?.trim() || limit.limitId || id;
  return [limit.primary, limit.secondary].flatMap((value) => {
    const window = normalizeUsageWindow(value);
    return window ? [{ ...window, kind: "model" as const, label }] : [];
  });
}

function namedWindow(value: AccountRateLimitNamedWindowResult): AccountUsageNamedWindow[] {
  const window = normalizeUsageWindow(value);
  if (!window) return [];
  const label = value.label?.trim() || null;
  const spentUsd = finiteNumberOrNull(value.spentUsd);
  const limitUsd = finiteNumberOrNull(value.limitUsd);
  return [
    {
      ...window,
      kind: value.kind,
      label,
      ...(spentUsd !== null && spentUsd >= 0 ? { spentUsd } : {}),
      ...(limitUsd !== null && limitUsd > 0 ? { limitUsd } : {}),
    },
  ];
}

function normalizeCredits(credits: AccountRateLimitResult["credits"]): AccountUsageCredits | null {
  if (!credits) return null;
  if (credits.unlimited === true) return { kind: "credits", balance: null, unlimited: true };
  if (credits.hasCredits !== true) return null;
  const balance = credits.balance?.trim() ? Number(credits.balance) : Number.NaN;
  return Number.isFinite(balance) ? { kind: "credits", balance, unlimited: false } : null;
}

function normalizeUsageWindow(window: AccountRateLimitWindowResult | null | undefined): AccountUsageWindow | null {
  const usedPercent = finiteNumberOrNull(window?.usedPercent);
  if (usedPercent === null) return null;
  const windowDurationMins = finiteNumberOrNull(window?.windowDurationMins);
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    // The contract takes whole minutes. A period that a provider measures from two timestamps
    // can have a fraction, and one such value would reject the whole reading.
    windowDurationMins: windowDurationMins === null || windowDurationMins < 0 ? null : Math.round(windowDurationMins),
    resetsAt: finiteNumberOrNull(window?.resetsAt),
  };
}

export function finiteNumberOrNull(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}
