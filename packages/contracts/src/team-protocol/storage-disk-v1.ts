import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const STORAGE_DISK_CAPABILITY = "storage-disk-v1";
export const STORAGE_DISK_ROUTES = { disk: "/v1/storage/disk" } as const;

export const STORAGE_DISK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [STORAGE_DISK_ROUTES.disk, adminRoute(empty, fields({ freeBytes: nullable(count), totalBytes: nullable(count) }))],
]);
