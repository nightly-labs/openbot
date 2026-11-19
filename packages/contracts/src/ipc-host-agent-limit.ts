import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord } from "./runtime-values";

export interface HostAgentLimitSettings {
  limit: number | null;
  defaultLimit: number;
  maxLimit: number;
}

export function hostAgentLimitSettings(limit: number | null): HostAgentLimitSettings {
  return { limit, defaultLimit: INPUT_LIMITS.agents, maxLimit: INPUT_LIMITS.hostAgentLimitMax };
}

export function decodeHostAgentLimitSettings(value: unknown): HostAgentLimitSettings {
  const bound = (item: unknown): item is number =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 1 && item <= INPUT_LIMITS.hostAgentLimitMax;
  if (
    !isDynamicRecord(value) ||
    (value.limit !== null && !bound(value.limit)) ||
    !bound(value.defaultLimit) ||
    !bound(value.maxLimit)
  ) {
    throw new Error("Invalid host agent limit.");
  }
  return { limit: value.limit, defaultLimit: value.defaultLimit, maxLimit: value.maxLimit };
}
