// Frozen optional instance-transfer-chunks-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server, never a member, can send an OpenBot transfer file to the host, or get one from it, in
// parts, so the file can be larger than the 100 MB of `instance-transfer-v1`. The whole file is at
// most 2 GiB - 1 byte, the limit of a transfer file on the host's own computer. Each id is the
// caller's own: another member's id reads as an id that does not exist.
//
// An upload starts with `upload/begin` ({ size, sha256 }). The same caller with the same size and
// SHA-256 gets the same upload again, with the parts that the host has, so a client can resume. One
// caller has one upload: a new one ends the one before. `upload/chunk` takes one part as the raw
// body, with `uploadId`, `index` and the part's `sha256` in the query. Each part is `chunkBytes`
// long, except the last. `upload/finish` checks every part and the whole file, and answers the
// preview of `instance-transfer-v1` stage, under a token that `instance-transfer-v1` apply and
// discard take. `upload/abort` ends an upload.
//
// An export starts with `export/begin`, which takes the `instance-transfer-v1` export input, writes
// the file on the host and answers its size, its SHA-256, the SHA-256 of each part and the warnings
// of the export.
// `export/chunk` answers one part as an attachment. `export/done` removes the file. The host removes
// an upload or export that has no request for 30 minutes. Widening any of it needs a second
// capability string.
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

/**
 * The size of one part that a host of this version uses. A client takes the `chunkBytes` that the
 * host answers. One part fits one WebRTC file transfer.
 */
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

/** A SHA-256 as 64 lower-case hexadecimal digits. */
const sha256: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error("Invalid admin digest.");
  return value;
};
/** 2 GiB - 1 byte in parts of 8 MiB. */
const parts = 256;

export const INSTANCE_TRANSFER_CHUNKS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin,
    adminRoute(
      fields({ size: count, sha256 }),
      fields({ uploadId: identifier, chunkBytes: count, received: list(count, parts) }),
    ),
  ],
  // The request body is the raw part, so its decoder never reads it.
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk, adminRoute(empty, fields({ receivedBytes: count }))],
  // The same preview as `instance-transfer-v1` stage.
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
  // The response is the part itself, sent as an attachment; only an error envelope is JSON.
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk, adminRoute(fields({ exportId: identifier, index: count }), empty)],
  [INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone, adminRoute(fields({ exportId: identifier }), empty)],
]);
