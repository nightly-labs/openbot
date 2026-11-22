import { type CacheExpiryCompactionSetting, DEFAULT_CACHE_EXPIRY_COMPACTION } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { PreferenceStore } from "./preference-file";

export type CacheExpiryCompactionPreferenceStore = PreferenceStore<CacheExpiryCompactionSetting>;

export function createCacheExpiryCompactionPreferenceStore(path: string): CacheExpiryCompactionPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CACHE_EXPIRY_COMPACTION,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}

export type CacheExpiryCompactionControl = ReturnType<typeof cacheExpiryCompactionControl>;

export function cacheExpiryCompactionControl(store: CacheExpiryCompactionPreferenceStore) {
  return {
    get: () => store.get(),
    set: Effect.fn("CacheExpiryCompaction.set")(function* (enabled: boolean) {
      return yield* store.set({ enabled });
    }),
  };
}
