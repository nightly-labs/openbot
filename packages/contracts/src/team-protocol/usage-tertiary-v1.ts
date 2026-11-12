import { isDynamicRecord, isNumber } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

/**
 * Frozen optional usage-tertiary-v1 contract: the third window of a usage limit. It adds `tertiary`
 * beside the frozen `id`, `primary` and `secondary` of each limit in:
 *
 * - the response of `GET /v1/agents/:agentId/usage`;
 * - the `usage` of a `usage-changed` event.
 *
 * `tertiary` has the keys of `primary`: `usedPercent`, `windowDurationMins` (a whole number or null)
 * and `resetsAt` (epoch seconds or null). It is the OpenCode or Kimi weekly or monthly window that
 * `secondary` does not hold, or the total of a Cursor plan. No usage limit check reads it.
 *
 * The host adds it only for a client that advertises the capability, on protocol 9, so the wire of
 * every released client stays as it was. Such a client shows two windows. The host leaves out a window
 * that this shape cannot describe. A host without the capability never sends the field, so a client
 * accepts it whenever it is present. A present value outside this shape fails closed. Widening any of
 * it needs a second capability string.
 */
export const TEAM_USAGE_TERTIARY_CAPABILITY = "usage-tertiary-v1";

/** The window with only the v1 keys, or null for a value that the v1 shape cannot describe. */
function v1Window(value: unknown): TeamProtocolV8BaseJsonObject | null {
  if (!isDynamicRecord(value)) return null;
  const { usedPercent, windowDurationMins, resetsAt } = value;
  if (!isNumber(usedPercent) || !Number.isFinite(usedPercent)) return null;
  if (
    windowDurationMins !== null &&
    !(isNumber(windowDurationMins) && Number.isInteger(windowDurationMins) && windowDurationMins >= 0)
  )
    return null;
  if (resetsAt !== null && !(isNumber(resetsAt) && Number.isFinite(resetsAt))) return null;
  return { usedPercent, windowDurationMins, resetsAt };
}

/**
 * `projected`, a usage reading after the frozen projection, with the `tertiary` of each limit of
 * `source`, the reading before it. The frozen projection keeps the limits in order, so the limit at
 * the same index with the same `id` is the source. The host passes `sending`, so a window outside the
 * v1 shape stays on the host; a client refuses it.
 */
export function withUsageTertiary(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.limits)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.limits)) return projected;
  const sourceLimits: unknown[] = source.limits;
  const limits = projected.limits.map((limit, index) => {
    const from = sourceLimits[index];
    if (!isDynamicRecord(limit) || !isDynamicRecord(from) || from.tertiary === undefined) return limit;
    if (from.id !== limit.id) return limit;
    const tertiary = v1Window(from.tertiary);
    if (tertiary) return { ...limit, tertiary };
    if (sending) return limit;
    throw new Error("Invalid usage window.");
  });
  return { ...projected, limits };
}

/** `projected`, a `usage-changed` event after the frozen projection, with the `tertiary` windows of `source`. */
export function withUsageEventTertiary(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "usage-changed" || !isDynamicRecord(source)) return projected;
  if (projected.usage === undefined) return projected;
  return { ...projected, usage: withUsageTertiary(projected.usage, source.usage, sending) };
}
