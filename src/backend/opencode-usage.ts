// The OpenCode Go quota, read from the endpoint the OpenCode console serves for the Go API key.
//
// OpenCode's ACP process does not report a quota, so this is a direct HTTPS request with the key the
// user pasted into OpenBot. The route is `packages/console/app/src/routes/zen/go/v1/usage.ts` in
// anomalyco/opencode; it answers `{ usage: { rolling, weekly, monthly } }`, each with an integer
// `percent` and an ISO `resetsAt`.

import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord, getString } from "./protocol";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const OPENCODE_GO_USAGE_TIMEOUT_MS = 10_000;
/** The Go plan's rolling window. The response carries the reset time but not the length. */
const ROLLING_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHLY_WINDOW_MINS = 43_200;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

/**
 * No key, a key the console rejects, and a key with no Go subscription all read as no usage, so the
 * dock hides the row instead of showing an error for the free catalog.
 */
export async function readOpenCodeGoUsage(apiKey: string | null): Promise<AccountRateLimitsReadResult> {
  if (!apiKey) return NO_USAGE;
  const response = await fetch(OPENCODE_GO_USAGE_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(OPENCODE_GO_USAGE_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) return NO_USAGE;
  if (!response.ok) throw new Error(`OpenCode Go usage returned HTTP ${response.status}.`);
  return openCodeGoRateLimits(await response.json());
}

/**
 * The account usage contract holds two windows, so the monthly and weekly readings share the second
 * one: whichever is closer to its limit, since that is the one that stops a turn first. When both
 * are spent, the one that resets later, since turns stay stopped until then.
 */
function openCodeGoRateLimits(value: unknown): AccountRateLimitsReadResult {
  const usage = getRecord(value, "usage");
  const rolling = usageWindow(getRecord(usage, "rolling"), ROLLING_WINDOW_MINS);
  const weekly = usageWindow(getRecord(usage, "weekly"), WEEKLY_WINDOW_MINS);
  const monthly = usageWindow(getRecord(usage, "monthly"), MONTHLY_WINDOW_MINS);
  const secondary = weekly && monthly ? bindingWindow(weekly, monthly) : (weekly ?? monthly);
  if (!rolling && !secondary) return NO_USAGE;
  return {
    rateLimits: { limitId: "opencode", primary: rolling, secondary },
    rateLimitsByLimitId: null,
  };
}

function bindingWindow<T extends { usedPercent: number; resetsAt?: number | null }>(weekly: T, monthly: T): T {
  if (weekly.usedPercent >= 100 && monthly.usedPercent >= 100) {
    return (monthly.resetsAt ?? Number.POSITIVE_INFINITY) >= (weekly.resetsAt ?? Number.POSITIVE_INFINITY)
      ? monthly
      : weekly;
  }
  return monthly.usedPercent > weekly.usedPercent ? monthly : weekly;
}

function usageWindow(
  window: DynamicRecord | null,
  windowDurationMins: number,
): (AccountRateLimitWindowResult & { usedPercent: number }) | null {
  if (!window || !isNumber(window.percent) || !Number.isFinite(window.percent)) return null;
  const resetsAt = Date.parse(getString(window, "resetsAt") ?? "");
  return {
    usedPercent: Math.max(0, Math.min(100, window.percent)),
    windowDurationMins,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt / 1_000 : null,
  };
}
