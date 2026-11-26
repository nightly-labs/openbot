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
import { INSTANCE_TRANSFER_FULL_COPY_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-full-copy-v1";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { decodeInstanceTransferExportState, fullCopyExportBody } from "@openbot/team-client/team-api-requests";
import { Effect, Schedule } from "effect";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";
import { readFully, sha256Hex, writeFully } from "./instance-transfer-chunks";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { AGENT_IMPORT_UPLOAD_TIMEOUT_MS, type RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError } from "./remote-service-effects";

type Remote = Pick<RemoteServerManager, "request" | "sendInstanceTransferPart" | "readInstanceTransferPart">;
type TransferError = ArchiveOperationError | RemoteWorkflowError;

const PART_RETRIES = 3;
const PROGRESS_INTERVAL_MS = 200;

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

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function protocolError(): Error {
  return new Error("Invalid instance transfer parts.");
}

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
  try {
    return decodeInstanceTransferExportState(value);
  } catch {
    throw protocolError();
  }
}

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

function progressReporter(size: number, report: ((sent: number, total: number) => void) | undefined) {
  let reported = -1;
  let reportedAt = 0;
  return (sent: number, force = false) => {
    if (!report || sent <= reported) return;
    const now = Date.now();
    if (!force && now - reportedAt < PROGRESS_INTERVAL_MS) return;
    reported = sent;
    reportedAt = now;
    report(Math.min(sent, size), size);
  };
}

export const uploadTransferInParts = Effect.fn("RemoteInstanceTransfer.upload")(function* (
  remote: Remote,
  serverId: string,
  path: string,
  onProgress?: (sent: number, total: number) => void,
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
    const partLength = (index: number) => Math.min(upload.chunkBytes, size - index * upload.chunkBytes);
    const report = progressReporter(size, onProgress);
    let done = 0;
    for (const index of received) if (index * upload.chunkBytes < size) done += partLength(index);
    report(done, true);
    const buffer = Buffer.allocUnsafe(Math.min(upload.chunkBytes, size));
    for (let index = 0; index * upload.chunkBytes < size; index++) {
      if (received.has(index)) continue;
      const position = index * upload.chunkBytes;
      const bytes = yield* archiveCall(() => readFully(handle, buffer, position, partLength(index)));
      const part = { uploadId: upload.uploadId, index, sha256: sha256Hex(bytes) };
      const before = done;
      yield* retryPart(
        remote.sendInstanceTransferPart(serverId, part, bytes, (sent) => report(before + Math.min(sent, bytes.length))),
      );
      done += bytes.length;
      report(done, true);
    }
    return yield* remote.request(
      serverId,
      INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish,
      decodeRemoteInstanceTransferPreview,
      { method: "POST", body: { uploadId: upload.uploadId }, timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS },
    );
  }).pipe(Effect.ensuring(archiveCall(() => handle.close()).pipe(Effect.ignore)));
});

function transferExportBegin(input: ExportInstanceInput, fullCopy: boolean) {
  return fullCopy
    ? { route: INSTANCE_TRANSFER_FULL_COPY_ROUTES.exportBegin, body: fullCopyExportBody(input) }
    : { route: INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin, body: input };
}

export const downloadTransferInParts = Effect.fn("RemoteInstanceTransfer.download")(function* (
  remote: Remote,
  serverId: string,
  input: ExportInstanceInput,
  destination: string,
  fullCopy = false,
  onProgress?: (received: number, total: number) => void,
): Effect.fn.Return<{ warnings: string[] }, TransferError> {
  const begin = transferExportBegin(input, fullCopy);
  const file = yield* remote.request(serverId, begin.route, decodeExportState, {
    method: "POST",
    body: begin.body,
    timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
  });
  const report = progressReporter(file.size, onProgress);
  report(0, true);
  const part = `${destination}.part`;
  yield* Effect.gen(function* () {
    const handle = yield* archiveCall(() => open(part, "w"));
    yield* Effect.gen(function* () {
      const whole = createHash("sha256");
      for (const [index, expected] of file.chunks.entries()) {
        const position = index * file.chunkBytes;
        const length = Math.min(file.chunkBytes, file.size - position);
        const partProgress = { size: length, onProgress: (received: number) => report(position + received) };
        const bytes = yield* retryPart(
          remote
            .readInstanceTransferPart(serverId, { exportId: file.exportId, index }, partProgress)
            .pipe(
              Effect.flatMap((bytes) =>
                bytes.length === length && sha256Hex(bytes) === expected
                  ? Effect.succeed(bytes)
                  : Effect.fail(invalidPart()),
              ),
            ),
        );
        whole.update(bytes);
        yield* archiveCall(() => writeFully(handle, bytes, position));
        report(position + bytes.length, true);
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
