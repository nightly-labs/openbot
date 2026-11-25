import { isBoolean, isDynamicRecord } from "./runtime-values";

export interface CacheExpiryCompactionSetting {
  enabled: boolean;
}

export const DEFAULT_CACHE_EXPIRY_COMPACTION: CacheExpiryCompactionSetting = { enabled: true };

export function decodeCacheExpiryCompactionSetting(value: unknown): CacheExpiryCompactionSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid cache expiry compaction setting.");
  return { enabled: value.enabled };
}
