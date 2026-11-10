// `instance-transfer-chunks-v1` on the desktop client: a transfer file to or from a joined server in
// parts, so it can be larger than one WebRTC file transfer. The file is read and written one part at
// a time, never whole in memory. A part that fails is sent again a few times; a host that refuses
// a request is not asked again. A failed upload stays on the host for 30 minutes, and the next
// upload of the same file sends only the parts that the host does not have.

import { createHash } from "node:crypto";
import { type FileHandle, open, rename, rm } from "node:fs/promises";
import {
  decodeRemoteInstanceTransferPreview,
  type ExportInstanceInput,
  INSTANCE_TRANSFER_LIMITS,
  type InstanceTransferPreview,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  INSTANCE_TRANSFER_CHUNK_BYTES,
  INSTANCE_TRANSFER_CHUNKS_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schedule } from "effect";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";
import { readFully, sha256Hex, writeFully } from "./instance-transfer-chunks";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { AGENT_IMPORT_UPLOAD_TIMEOUT_MS, type RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError } from "./remote-service-effects";

type Remote = Pick<RemoteServerManager, "request" | "sendInstanceTransferPart" | "readInstanceTransferPart">;
type TransferError = ArchiveOperationError | RemoteWorkflowError;

/** How many more times one part is sent or read after it fails. */
const PART_RETRIES = 3;

interface UploadState {
  uploadId: string;
  chunkBytes: number;
  received: number[];
}

interface ExportState {
  exportId: string;
  size: number;
  sha256: string;
  chunkBytes: number;
  chunks: string[];
  warnings: string[];
}

const SHA256 = /^[0-9a-f]{64}$/u;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The client turns a decoder failure into a protocol error. */
function protocolError(): Error {
  return new Error("Invalid instance transfer parts.");
}

/** A part size that one WebRTC file transfer carries. */
function isPartSize(value: unknown): value is number {
  return isCount(value) && value > 0 && value <= INSTANCE_TRANSFER_REMOTE_BYTES;
}

function decodeUploadState(value: unknown): UploadState {
  if (
    !isDynamicRecord(value) ||
    !isString(value.uploadId) ||
    !isPartSize(value.chunkBytes) ||
    !Array.isArray(value.received) ||
    !value.received.every(isCount)
  )
    throw protocolError();
  return { uploadId: value.uploadId, chunkBytes: value.chunkBytes, received: value.received };
}

function decodeExportState(value: unknown): ExportState {
  if (
    !isDynamicRecord(value) ||
    !isString(value.exportId) ||
    !isCount(value.size) ||
    value.size === 0 ||
    value.size > INSTANCE_TRANSFER_LIMITS.archiveBytes ||
    !isString(value.sha256) ||
    !SHA256.test(value.sha256) ||
    !isPartSize(value.chunkBytes) ||
    !Array.isArray(value.chunks) ||
    value.chunks.length !== Math.ceil(value.size / value.chunkBytes) ||
    !value.chunks.every((chunk) => isString(chunk) && SHA256.test(chunk)) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isString)
  )
    throw protocolError();
  return {
    exportId: value.exportId,
    size: value.size,
    sha256: value.sha256,
    chunkBytes: value.chunkBytes,
    chunks: value.chunks.filter(isString),
    warnings: value.warnings.filter(isString),
  };
}

/** A host that answers a request and refuses it gets the same request again only from the user. */
function isRefusal(error: TransferError): boolean {
  if (!(error instanceof RemoteWorkflowError)) return false;
  const { cause } = error;
  return (
    cause instanceof RemoteProtocolError ||
    (cause instanceof RemoteRequestError &&
      cause.status >= 400 &&
      cause.status < 500 &&
      cause.status !== 408 &&
      cause.status !== 429)
  );
}

function retryPart<A>(part: Effect.Effect<A, TransferError>): Effect.Effect<A, TransferError> {
  return part.pipe(
    Effect.retry({
      times: PART_RETRIES,
      schedule: Schedule.exponential("1 second"),
      while: (error) => !isRefusal(error),
    }),
  );
}

function invalidPart(): ArchiveOperationError {
  return archiveFailure(new Error(sourceText("error.import.transferPartInvalid")));
}

async function hashFile(handle: FileHandle, size: number, buffer: Buffer): Promise<string> {
  const hash = createHash("sha256");
  for (let position = 0; position < size; position += buffer.length)
    hash.update(await readFully(handle, buffer, position, Math.min(buffer.length, size - position)));
  return hash.digest("hex");
}

/** Sends the file at `path` to the host and answers the preview of `instance-transfer-v1` stage. */
export const uploadTransferInParts = Effect.fn("RemoteInstanceTransfer.upload")(function* (
  remote: Remote,
  serverId: string,
  path: string,
): Effect.fn.Return<InstanceTransferPreview, TransferError> {
  const handle = yield* archiveCall(() => open(path, "r"));
  return yield* Effect.gen(function* () {
    const info = yield* archiveCall(() => handle.stat());
    if (!info.isFile() || info.size === 0)
      return yield* archiveFailure(new Error(sourceText("error.import.chooseZip")));
    if (info.size > INSTANCE_TRANSFER_LIMITS.archiveBytes)
      return yield* archiveFailure(new Error(sourceText("error.import.transferTooLarge")));
    const { size } = info;
    const sha256 = yield* archiveCall(() =>
      hashFile(handle, size, Buffer.allocUnsafe(Math.min(INSTANCE_TRANSFER_CHUNK_BYTES, size))),
    );
    const upload = yield* remote.request(serverId, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, decodeUploadState, {
      method: "POST",
      body: { size, sha256 },
      timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
    });
    const received = new Set(upload.received);
    const buffer = Buffer.allocUnsafe(Math.min(upload.chunkBytes, size));
    for (let index = 0; index * upload.chunkBytes < size; index++) {
      if (received.has(index)) continue;
      const position = index * upload.chunkBytes;
      const bytes = yield* archiveCall(() =>
        readFully(handle, buffer, position, Math.min(upload.chunkBytes, size - position)),
      );
      const part = { uploadId: upload.uploadId, index, sha256: sha256Hex(bytes) };
      yield* retryPart(remote.sendInstanceTransferPart(serverId, part, bytes));
    }
    return yield* remote.request(
      serverId,
      INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish,
      decodeRemoteInstanceTransferPreview,
      { method: "POST", body: { uploadId: upload.uploadId }, timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS },
    );
  }).pipe(Effect.ensuring(archiveCall(() => handle.close()).pipe(Effect.ignore)));
});

/** Writes the host's transfer file to `destination`. The file appears only when it is complete. */
export const downloadTransferInParts = Effect.fn("RemoteInstanceTransfer.download")(function* (
  remote: Remote,
  serverId: string,
  input: ExportInstanceInput,
  destination: string,
): Effect.fn.Return<{ warnings: string[] }, TransferError> {
  const file = yield* remote.request(serverId, INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin, decodeExportState, {
    method: "POST",
    body: input,
    timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
  });
  const part = `${destination}.part`;
  yield* Effect.gen(function* () {
    const handle = yield* archiveCall(() => open(part, "w"));
    yield* Effect.gen(function* () {
      const whole = createHash("sha256");
      for (const [index, expected] of file.chunks.entries()) {
        const length = Math.min(file.chunkBytes, file.size - index * file.chunkBytes);
        const bytes = yield* retryPart(
          remote
            .readInstanceTransferPart(serverId, { exportId: file.exportId, index })
            .pipe(
              Effect.flatMap((bytes) =>
                bytes.length === length && sha256Hex(bytes) === expected
                  ? Effect.succeed(bytes)
                  : Effect.fail(invalidPart()),
              ),
            ),
        );
        whole.update(bytes);
        yield* archiveCall(() => writeFully(handle, bytes, index * file.chunkBytes));
      }
      if (whole.digest("hex") !== file.sha256) return yield* invalidPart();
    }).pipe(Effect.ensuring(archiveCall(() => handle.close()).pipe(Effect.ignore)));
    yield* archiveCall(() => rename(part, destination));
  }).pipe(
    Effect.tapError(() => archiveCall(() => rm(part, { force: true })).pipe(Effect.ignore)),
    Effect.ensuring(
      remote
        .request(serverId, INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone, () => undefined, {
          method: "POST",
          body: { exportId: file.exportId },
        })
        .pipe(Effect.ignore),
    ),
  );
  return { warnings: file.warnings };
});
