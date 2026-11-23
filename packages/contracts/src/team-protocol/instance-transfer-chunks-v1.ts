import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { INSTANCE_TRANSFER_PREVIEW } from "./instance-transfer-v1";

export const INSTANCE_TRANSFER_CHUNKS_CAPABILITY = "instance-transfer-chunks-v1";

export const INSTANCE_TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;

export const INSTANCE_TRANSFER_CHUNKS_ROUTES = {
  uploadBegin: "/v1/instance-transfer-chunks/upload/begin",
  uploadChunk: "/v1/instance-transfer-chunks/upload/chunk",
  uploadFinish: "/v1/instance-transfer-chunks/upload/finish",
  uploadAbort: "/v1/instance-transfer-chunks/upload/abort",
  exportBegin: "/v1/instance-transfer-chunks/export/begin",
  exportChunk: "/v1/instance-transfer-chunks/export/chunk",
  exportDone: "/v1/instance-transfer-chunks/export/done",
} as const;

const sha256: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error("Invalid admin digest.");
  return value;
};
const parts = 256;

export const INSTANCE_TRANSFER_CHUNKS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin,
    adminRoute(
      fields({ size: count, sha256 }),
      fields({ uploadId: identifier, chunkBytes: count, received: list(count, parts) }),
    ),
  ],
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk, adminRoute(empty, fields({ receivedBytes: count }))],
  [
    INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish,
    adminRoute(fields({ uploadId: identifier }), INSTANCE_TRANSFER_PREVIEW),
  ],
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadAbort, adminRoute(fields({ uploadId: identifier }), empty)],
  [
    INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin,
    adminRoute(
      fields(
        { agentIds: list(identifier, 100), includeFiles: boolean, includeSettings: boolean },
        { includeHistory: boolean },
      ),
      fields({
        exportId: identifier,
        size: count,
        sha256,
        chunkBytes: count,
        chunks: list(sha256, parts),
        warnings: list(string(500), 200),
      }),
    ),
  ],
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk, adminRoute(fields({ exportId: identifier, index: count }), empty)],
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone, adminRoute(fields({ exportId: identifier }), empty)],
]);
