import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AccountUsage,
  type AccountUsageGroup,
  type AccountUsageLimit,
  type AccountUsageWindow,
  MAX_USAGE_GROUPS,
} from "@openbot/contracts/ipc";
import { isNumber } from "@openbot/contracts/runtime-values";
import type { AccountRateLimitGroupResult, AccountRateLimitResult, AccountRateLimitsReadResult } from "../protocol";

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
  // Codex model window mixed into the same unlabeled list.
  const selectedEntries = model ? selectModelRateLimits(entries, model, fallback) : fallback ? [fallback] : entries;
  const limits = selectedEntries.map(([id, limit]) => normalizeAccountLimit(id, limit));
  // Antigravity's groups belong to the one reading that it sends.
  const groups = rateLimits?.groups?.slice(0, MAX_USAGE_GROUPS).map(normalizeUsageGroup);
  if (groups?.length && limits.length === 1 && limits[0]) limits[0] = { ...limits[0], groups };
  if (rateLimits?.sharedQuotaWith && limits.length === 1 && limits[0])
    limits[0] = { ...limits[0], sharedQuotaWith: rateLimits.sharedQuotaWith };

  return { limits };
}

function normalizeUsageGroup(group: AccountRateLimitGroupResult): AccountUsageGroup {
  return {
    name: group.name.slice(0, INPUT_LIMITS.identifier),
    models: group.models.slice(0, MAX_USAGE_GROUPS).map((model) => model.slice(0, INPUT_LIMITS.identifier)),
    primary: normalizeUsageWindow(group.primary),
    secondary: normalizeUsageWindow(group.secondary),
  };
}

/**
 * True once a window of a kept reading, or of one of its groups, has passed its reset time, so the
 * reading is stale. `resetsAt` is in seconds.
 */
export function usageWindowHasReset(limit: AccountUsageLimit): boolean {
  const now = Date.now() / 1_000;
  return [limit, ...(limit.groups ?? [])].some((group) =>
    [group.primary, group.secondary].some((window) => window?.resetsAt != null && window.resetsAt <= now),
  );
}

/**
 * True when a window of the reading, or of one of its groups, reset after `sinceMs` and before now. A window
 * that had already reset when the reading was taken does not count, so it cannot ask for a read each time.
 */
export function usageWindowResetSince(limit: AccountUsageLimit, sinceMs: number): boolean {
  const now = Date.now() / 1_000;
  const since = sinceMs / 1_000;
  return [limit, ...(limit.groups ?? [])].some((group) =>
    [group.primary, group.secondary].some(
      (window) => window?.resetsAt != null && window.resetsAt > since && window.resetsAt <= now,
    ),
  );
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
  return {
    id: limit.limitId ?? id,
    primary: normalizeUsageWindow(limit.primary),
    secondary: normalizeUsageWindow(limit.secondary),
  };
}

function normalizeUsageWindow(window: AccountRateLimitResult["primary"]): AccountUsageWindow | null {
  const usedPercent = finiteNumberOrNull(window?.usedPercent);
  if (usedPercent === null) return null;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowDurationMins: finiteNumberOrNull(window?.windowDurationMins),
    resetsAt: finiteNumberOrNull(window?.resetsAt),
  };
}

export function finiteNumberOrNull(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}
