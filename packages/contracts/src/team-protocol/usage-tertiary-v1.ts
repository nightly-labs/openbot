import { isAccountUsageWindow } from "../ipc-agent-status";
import { isDynamicRecord } from "../runtime-values";
import { TEAM_API_ROUTES } from "../team-api-routes";
import { scopedUsageRoute } from "./current-adapter-routes";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

export const TEAM_USAGE_TERTIARY_CAPABILITY = "usage-tertiary-v1";

export function isUsageRoute(method: string, path: string): boolean {
  return (
    (method === "GET" && new URL(path, "http://openbot.invalid").pathname === TEAM_API_ROUTES.agents.usage) ||
    scopedUsageRoute(method, path)
  );
}

function v1Window(value: unknown): TeamProtocolV8BaseJsonObject | null {
  if (!isAccountUsageWindow(value)) return null;
  const { usedPercent, windowDurationMins, resetsAt } = value;
  return { usedPercent, windowDurationMins, resetsAt };
}

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

export function withUsageEventTertiary(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "usage-changed" || !isDynamicRecord(source)) return projected;
  if (projected.usage === undefined) return projected;
  return { ...projected, usage: withUsageTertiary(projected.usage, source.usage, sending) };
}
