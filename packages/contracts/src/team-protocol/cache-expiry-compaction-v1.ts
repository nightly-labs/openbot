import type { CacheExpiryCompactionSetting } from "../ipc-cache-expiry-compaction";
import { isBoolean, isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const CACHE_EXPIRY_COMPACTION_CAPABILITY = "cache-expiry-compaction-v1";

export const CACHE_EXPIRY_COMPACTION_ROUTES = {
  settings: "/v1/admin/host/cache-expiry-compaction",
  update: "/v1/admin/host/cache-expiry-compaction/update",
} as const;

const snapshot = fields({ enabled: boolean });

export const CACHE_EXPIRY_COMPACTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CACHE_EXPIRY_COMPACTION_ROUTES.settings, adminRoute(empty, snapshot)],
  [CACHE_EXPIRY_COMPACTION_ROUTES.update, adminRoute(snapshot, snapshot)],
]);

export function decodeCacheExpiryCompactionResponse(value: unknown): CacheExpiryCompactionSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid cache expiry compaction setting.");
  return { enabled: value.enabled };
}
