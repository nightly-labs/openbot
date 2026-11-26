import { type AccountUsageWindow, isAccountUsageGroup, MAX_USAGE_GROUPS } from "../ipc-agent-status";
import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

export const TEAM_USAGE_GROUPS_CAPABILITY = "usage-groups-v1";

function v1Window(window: AccountUsageWindow | null): TeamProtocolV8BaseJsonObject | null {
  if (window === null) return null;
  const { usedPercent, windowDurationMins, resetsAt } = window;
  return { usedPercent, windowDurationMins, resetsAt };
}

function v1Groups(value: unknown): TeamProtocolV8BaseJsonObject[] | null {
  if (!Array.isArray(value) || value.length > MAX_USAGE_GROUPS || !value.every(isAccountUsageGroup)) return null;
  return value.map((group) => ({
    name: group.name,
    models: [...group.models],
    primary: v1Window(group.primary),
    secondary: v1Window(group.secondary),
  }));
}

export function withUsageGroups(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.limits)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.limits)) return projected;
  const sourceLimits: unknown[] = source.limits;
  const limits = projected.limits.map((limit, index) => {
    const from = sourceLimits[index];
    if (!isDynamicRecord(limit) || !isDynamicRecord(from) || from.groups === undefined) return limit;
    if (from.id !== limit.id) return limit;
    const groups = v1Groups(from.groups);
    if (groups) return { ...limit, groups };
    if (sending) return limit;
    throw new Error("Invalid usage groups.");
  });
  return { ...projected, limits };
}

export function withUsageEventGroups(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "usage-changed" || !isDynamicRecord(source)) return projected;
  if (projected.usage === undefined) return projected;
  return { ...projected, usage: withUsageGroups(projected.usage, source.usage, sending) };
}
