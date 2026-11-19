import { isDynamicRecord, isOneOf } from "./runtime-values";

export const PROMPT_CACHE_TTLS = ["5m", "1h"] as const;
export type PromptCacheTtl = (typeof PROMPT_CACHE_TTLS)[number];

export interface PromptCacheTtlSetting {
  ttl: PromptCacheTtl;
}

export const DEFAULT_PROMPT_CACHE_TTL: PromptCacheTtlSetting = { ttl: "5m" };

export function isPromptCacheTtl(value: unknown): value is PromptCacheTtl {
  return isOneOf(PROMPT_CACHE_TTLS, value);
}

export function decodePromptCacheTtlSetting(value: unknown): PromptCacheTtlSetting {
  if (!isDynamicRecord(value) || !isPromptCacheTtl(value.ttl)) throw new Error("Invalid prompt cache time.");
  return { ttl: value.ttl };
}
