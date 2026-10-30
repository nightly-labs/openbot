/**
 * How long a server asks the provider to keep the prompt cache of its agents (`prompt-cache-ttl-v1`),
 * as the desktop main process, the preload and the browser client read it. On the wire the route
 * codec has already checked the field; this gives it its IPC type and fails closed on anything else.
 */

import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * `1h` asks Claude Code for a one-hour cache, also for subagents and for a subscription on extra
 * usage. `5m` leaves Claude Code's own choice: five minutes with an API key, one hour for the main
 * thread of a Claude subscription within its limits.
 */
export const PROMPT_CACHE_TTLS = ["5m", "1h"] as const;
export type PromptCacheTtl = (typeof PROMPT_CACHE_TTLS)[number];

export interface PromptCacheTtlSetting {
  ttl: PromptCacheTtl;
}

/** Claude Code's own choice, so that a server pays for a one-hour cache write only when its owner asks. */
export const DEFAULT_PROMPT_CACHE_TTL: PromptCacheTtlSetting = { ttl: "5m" };

export function isPromptCacheTtl(value: unknown): value is PromptCacheTtl {
  return isOneOf(PROMPT_CACHE_TTLS, value);
}

export function decodePromptCacheTtlSetting(value: unknown): PromptCacheTtlSetting {
  if (!isDynamicRecord(value) || !isPromptCacheTtl(value.ttl)) throw new Error("Invalid prompt cache time.");
  return { ttl: value.ttl };
}
