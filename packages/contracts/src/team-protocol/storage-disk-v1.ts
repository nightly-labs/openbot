// Frozen optional storage-disk-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: every signed-in member of a
// server can read the free and total bytes of the disk that holds the host data. It is one statfs
// call, not a scan, so a client can ask often. It carries no path and changes nothing on the host.
// Bounds and meaning do not follow IPC changes; widening any of it needs a second capability string.
import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const STORAGE_DISK_CAPABILITY = "storage-disk-v1";
export const STORAGE_DISK_ROUTES = { disk: "/v1/storage/disk" } as const;

export const STORAGE_DISK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [STORAGE_DISK_ROUTES.disk, adminRoute(empty, fields({ freeBytes: nullable(count), totalBytes: nullable(count) }))],
]);
