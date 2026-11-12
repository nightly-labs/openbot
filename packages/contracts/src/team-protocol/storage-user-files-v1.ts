// Frozen optional storage-user-files-v1 wire contract: the disk of `storage-disk-v1`, and the bytes of
// the files of the server's user on it.
//
// What it grants, recorded here because freezing it makes it permanent: every signed-in member of a
// server can read the free and total bytes of the disk that holds the host data, as `storage-disk-v1`
// gives, and the bytes that the files of the user who runs OpenBot use on that disk. It carries no
// path and changes nothing on the host. `userBytes` is null when the host does not measure it: a host
// that is not a hosted server, or a machine with Docker, whose images are not in the home folder.
// Bounds and meaning do not follow IPC changes; widening any of it needs a second capability string.
import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const STORAGE_USER_FILES_CAPABILITY = "storage-user-files-v1";
export const STORAGE_USER_FILES_ROUTES = { disk: "/v1/storage/user-files" } as const;

export const STORAGE_USER_FILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    STORAGE_USER_FILES_ROUTES.disk,
    adminRoute(empty, fields({ freeBytes: nullable(count), totalBytes: nullable(count), userBytes: nullable(count) })),
  ],
]);
