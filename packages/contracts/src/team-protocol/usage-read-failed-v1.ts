import type { AccountUsage } from "../ipc-agent-status";
import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV8BaseJsonValue } from "./v8-base";

/**
 * The host sends a limit with `readFailed` for a provider whose own usage read failed, so the client
 * shows the provider as unavailable instead of hiding it (#11771).
 */
export const TEAM_USAGE_READ_FAILED_CAPABILITY = "usage-read-failed-v1";

/** The usage for a peer without the capability: the same limits as before it, with no failed read. */
export function usageWithoutReadFailed(usage: AccountUsage): AccountUsage {
  return usage.limits.some((limit) => limit.readFailed === true)
    ? { ...usage, limits: usage.limits.filter((limit) => limit.readFailed !== true) }
    : usage;
}

/**
 * The `usage-changed` usage for a peer without the capability, or null when the event must not be sent:
 * an older client reads an event with no limits as "no sign-in has a reading" and clears its rail.
 */
export function usageEventWithoutReadFailed(usage: AccountUsage): AccountUsage | null {
  const sent = usageWithoutReadFailed(usage);
  return sent.limits.length === 0 && usage.limits.length > 0 ? null : sent;
}

export function withUsageReadFailed(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.limits)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.limits)) return projected;
  const sourceLimits: unknown[] = source.limits;
  const limits = projected.limits.map((limit, index) => {
    const from = sourceLimits[index];
    if (!isDynamicRecord(limit) || !isDynamicRecord(from) || from.readFailed === undefined) return limit;
    if (from.id !== limit.id) return limit;
    if (from.readFailed === true && limit.primary === null && limit.secondary === null)
      return { ...limit, readFailed: true };
    if (sending) return limit;
    throw new Error("Invalid usage read state.");
  });
  return { ...projected, limits };
}

export function withUsageEventReadFailed(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "usage-changed" || !isDynamicRecord(source)) return projected;
  if (projected.usage === undefined) return projected;
  return { ...projected, usage: withUsageReadFailed(projected.usage, source.usage, sending) };
}
