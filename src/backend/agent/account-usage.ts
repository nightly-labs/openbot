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
  const selectedEntries = model ? selectModelRateLimits(entries, model, fallback) : fallback ? [fallback] : entries;
  const limits = selectedEntries.map(([id, limit]) => normalizeAccountLimit(id, limit));
  const groups = rateLimits?.groups?.slice(0, MAX_USAGE_GROUPS).map(normalizeUsageGroup);
  if (groups?.length && limits.length === 1 && limits[0]) limits[0] = { ...limits[0], groups };
  if (rateLimits?.sharedQuotaWith && limits.length === 1 && limits[0])
    limits[0] = { ...limits[0], sharedQuotaWith: rateLimits.sharedQuotaWith };
  const tertiary = normalizeUsageWindow(rateLimits?.tertiary);
  if (tertiary && limits.length === 1 && limits[0]) limits[0] = { ...limits[0], tertiary };

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

export function usageWindowHasReset(limit: AccountUsageLimit): boolean {
  const now = Date.now() / 1_000;
  return [limit, ...(limit.groups ?? [])].some((group) =>
    usageWindows(group).some((window) => window?.resetsAt != null && window.resetsAt <= now),
  );
}

export function usageWindowResetSince(limit: AccountUsageLimit, sinceMs: number): boolean {
  const now = Date.now() / 1_000;
  const since = sinceMs / 1_000;
  return [limit, ...(limit.groups ?? [])].some((group) =>
    usageWindows(group).some((window) => window?.resetsAt != null && window.resetsAt > since && window.resetsAt <= now),
  );
}

function usageWindows(limit: Pick<AccountUsageLimit, "primary" | "secondary" | "tertiary">) {
  return [limit.primary, limit.secondary, limit.tertiary];
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
    ...(limit.credits === undefined ? {} : { creditsAvailable: limit.credits?.available ?? false }),
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
