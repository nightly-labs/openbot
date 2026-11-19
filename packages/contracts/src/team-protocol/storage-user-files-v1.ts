import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const STORAGE_USER_FILES_CAPABILITY = "storage-user-files-v1";
export const STORAGE_USER_FILES_ROUTES = { disk: "/v1/storage/user-files" } as const;

export const STORAGE_USER_FILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    STORAGE_USER_FILES_ROUTES.disk,
    adminRoute(empty, fields({ freeBytes: nullable(count), totalBytes: nullable(count), userBytes: nullable(count) })),
  ],
]);
