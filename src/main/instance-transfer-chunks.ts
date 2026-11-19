import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ExportInstanceInput,
  INSTANCE_TRANSFER_LIMITS,
  type InstanceTransferPreview,
} from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_CHUNK_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect } from "effect";
import { diskSpace } from "../backend/storage-usage";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";

const IDLE_TTL_MS = 30 * 60_000;
const FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;

export interface InstanceTransferChunkFiles {
  directory: () => Effect.Effect<string, ArchiveOperationError>;
  stage: (path: string, owner: string) => Effect.Effect<InstanceTransferPreview, ArchiveOperationError>;
  exportTo: (
    path: string,
    input: ExportInstanceInput,
    exporter: string,
  ) => Effect.Effect<{ warnings: readonly string[] }, ArchiveOperationError>;
}

interface Upload {
  id: string;
  owner: string;
  size: number;
  sha256: string;
  path: string;
  received: Set<number>;
  writing: number;
  timer: NodeJS.Timeout;
}

interface Finish {
  owner: string;
  size: number;
  result: Deferred.Deferred<InstanceTransferPreview, ArchiveOperationError>;
}

interface Export {
  id: string;
  owner: string;
  path: string;
  size: number;
  timer: NodeJS.Timeout;
}

export interface InstanceTransferUploadState {
  uploadId: string;
  chunkBytes: number;
  received: number[];
}

export interface InstanceTransferExportState {
  exportId: string;
  size: number;
  sha256: string;
  chunkBytes: number;
  chunks: string[];
  warnings: string[];
}

export interface InstanceTransferExportPart {
  path: string;
  start: number;
  length: number;
}

const closed = () => archiveFailure(new Error(sourceText("error.import.transferPartsClosed")));
const invalidPart = () => archiveFailure(new Error(sourceText("error.import.transferPartInvalid")));

function partCount(size: number): number {
  return Math.ceil(size / INSTANCE_TRANSFER_CHUNK_BYTES);
}

function partLength(size: number, index: number): number {
  return Math.min(INSTANCE_TRANSFER_CHUNK_BYTES, size - index * INSTANCE_TRANSFER_CHUNK_BYTES);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readFully(handle: FileHandle, buffer: Buffer, position: number, length: number): Promise<Buffer> {
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) throw new Error(sourceText("error.import.transferPartInvalid"));
    read += bytesRead;
  }
  return buffer.subarray(0, length);
}

async function hashParts(path: string, size: number): Promise<{ sha256: string; chunks: string[] }> {
  const handle = await open(path, "r");
  try {
    const whole = createHash("sha256");
    const chunks: string[] = [];
    const buffer = Buffer.allocUnsafe(Math.min(INSTANCE_TRANSFER_CHUNK_BYTES, size));
    for (let index = 0; index < partCount(size); index++) {
      const part = await readFully(handle, buffer, index * INSTANCE_TRANSFER_CHUNK_BYTES, partLength(size, index));
      whole.update(part);
      chunks.push(sha256Hex(part));
    }
    return { sha256: whole.digest("hex"), chunks };
  } finally {
    await handle.close();
  }
}

export async function writeFully(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, position + written);
    written += bytesWritten;
  }
}

export class InstanceTransferChunks {
  readonly #uploads = new Map<string, Upload>();
  readonly #finishes = new Map<string, Finish>();
  readonly #exports = new Map<string, Export>();

  constructor(private readonly files: InstanceTransferChunkFiles) {}

  readonly beginUpload = Effect.fn("InstanceTransferChunks.beginUpload")(function* (
    this: InstanceTransferChunks,
    input: { size: number; sha256: string },
    owner: string,
  ): Effect.fn.Return<InstanceTransferUploadState, ArchiveOperationError> {
    if (input.size === 0) return yield* archiveFailure(new Error(sourceText("error.import.transferNotFile")));
    if (input.size > INSTANCE_TRANSFER_LIMITS.archiveBytes)
      return yield* archiveFailure(new Error(sourceText("error.import.transferTooLarge")));
    const current = [...this.#uploads.values()].find((upload) => upload.owner === owner);
    if (current && current.size === input.size && current.sha256 === input.sha256) {
      current.timer.refresh();
      return this.#uploadState(current);
    }
    if (current) yield* this.#dropUpload(current);
    const directory = yield* this.files.directory();
    const { freeBytes } = yield* diskSpace(directory);
    if (freeBytes !== null && freeBytes < input.size + FREE_SPACE_MARGIN_BYTES)
      return yield* archiveFailure(new Error(sourceText("error.import.transferNoSpace")));
    const id = randomUUID();
    const path = join(directory, `${id}.part`);
    yield* archiveCall(async () => (await open(path, "wx", 0o600)).close());
    const upload: Upload = {
      id,
      owner,
      size: input.size,
      sha256: input.sha256,
      path,
      received: new Set(),
      writing: 0,
      timer: setTimeout(() => {
        if (this.#uploads.get(id) === upload && upload.writing === 0) void Effect.runPromise(this.#dropUpload(upload));
        else upload.timer.refresh();
      }, IDLE_TTL_MS).unref(),
    };
    this.#uploads.set(id, upload);
    return this.#uploadState(upload);
  }).bind(this);

  readonly writePart = Effect.fn("InstanceTransferChunks.writePart")(function* (
    this: InstanceTransferChunks,
    input: { uploadId: string; index: number; sha256: string },
    read: (limit: number) => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<{ receivedBytes: number }, ArchiveOperationError> {
    const finishedSize = this.#finishedSize(input.uploadId, owner);
    if (finishedSize !== null) {
      yield* archiveCall(() => read(INSTANCE_TRANSFER_CHUNK_BYTES));
      return { receivedBytes: finishedSize };
    }
    const upload = yield* this.#ownUpload(input.uploadId, owner);
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= partCount(upload.size))
      return yield* invalidPart();
    upload.timer.refresh();
    const bytes = yield* archiveCall(() => read(INSTANCE_TRANSFER_CHUNK_BYTES));
    if (bytes.length !== partLength(upload.size, input.index) || sha256Hex(bytes) !== input.sha256)
      return yield* invalidPart();
    if (this.#uploads.get(upload.id) !== upload) {
      const size = this.#finishedSize(upload.id, owner);
      return size === null ? yield* closed() : { receivedBytes: size };
    }
    upload.writing++;
    yield* archiveCall(async () => {
      const handle = await open(upload.path, "r+");
      try {
        await writeFully(handle, bytes, input.index * INSTANCE_TRANSFER_CHUNK_BYTES);
      } finally {
        await handle.close();
      }
    }).pipe(Effect.ensuring(Effect.sync(() => upload.writing--)));
    upload.received.add(input.index);
    upload.timer.refresh();
    let receivedBytes = 0;
    for (const index of upload.received) receivedBytes += partLength(upload.size, index);
    return { receivedBytes };
  }).bind(this);

  readonly finishUpload = Effect.fn("InstanceTransferChunks.finishUpload")(function* (
    this: InstanceTransferChunks,
    uploadId: string,
    owner: string,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    const finished = this.#finishes.get(uploadId);
    if (finished) return finished.owner === owner ? yield* Deferred.await(finished.result) : yield* closed();
    const upload = yield* this.#ownUpload(uploadId, owner);
    if (upload.writing > 0 || upload.received.size !== partCount(upload.size)) return yield* invalidPart();
    this.#uploads.delete(upload.id);
    clearTimeout(upload.timer);
    const finish: Finish = { owner, size: upload.size, result: Deferred.makeUnsafe() };
    this.#finishes.set(upload.id, finish);
    const zip = upload.path.replace(/\.part$/u, ".zip");
    return yield* Effect.gen({ self: this }, function* () {
      const info = yield* archiveCall(() => stat(upload.path));
      const { sha256 } = yield* archiveCall(() => hashParts(upload.path, upload.size));
      if (info.size !== upload.size || sha256 !== upload.sha256) return yield* invalidPart();
      yield* archiveCall(() => rename(upload.path, zip));
      return yield* this.files.stage(zip, owner);
    }).pipe(
      Effect.tapError(() =>
        Effect.all([
          archiveCall(() => rm(upload.path, { force: true })),
          archiveCall(() => rm(zip, { force: true })),
        ]).pipe(Effect.ignore),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          Deferred.doneUnsafe(finish.result, exit);
          setTimeout(() => {
            if (this.#finishes.get(upload.id) === finish) this.#finishes.delete(upload.id);
          }, IDLE_TTL_MS).unref();
        }),
      ),
    );
  }).bind(this);

  readonly abortUpload = Effect.fn("InstanceTransferChunks.abortUpload")(function* (
    this: InstanceTransferChunks,
    uploadId: string,
    owner: string,
  ) {
    const upload = this.#uploads.get(uploadId);
    if (upload && upload.owner === owner) yield* this.#dropUpload(upload);
  }).bind(this);

  readonly beginExport = Effect.fn("InstanceTransferChunks.beginExport")(function* (
    this: InstanceTransferChunks,
    input: ExportInstanceInput,
    owner: string,
  ): Effect.fn.Return<InstanceTransferExportState, ArchiveOperationError> {
    for (const current of [...this.#exports.values()]) if (current.owner === owner) yield* this.#dropExport(current);
    const directory = yield* this.files.directory();
    const id = randomUUID();
    const path = join(directory, `${id}.zip`);
    const hashed = yield* Effect.gen({ self: this }, function* () {
      const { warnings } = yield* this.files.exportTo(path, input, owner);
      const { size } = yield* archiveCall(() => stat(path));
      return { size, warnings, ...(yield* archiveCall(() => hashParts(path, size))) };
    }).pipe(Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)));
    const entry: Export = {
      id,
      owner,
      path,
      size: hashed.size,
      timer: setTimeout(() => {
        if (this.#exports.get(id) === entry) void Effect.runPromise(this.#dropExport(entry));
      }, IDLE_TTL_MS).unref(),
    };
    this.#exports.set(id, entry);
    return {
      exportId: id,
      size: hashed.size,
      sha256: hashed.sha256,
      chunkBytes: INSTANCE_TRANSFER_CHUNK_BYTES,
      chunks: hashed.chunks,
      warnings: hashed.warnings.slice(0, 200).map((warning) => warning.slice(0, 500)),
    };
  }).bind(this);

  readonly exportPart = Effect.fn("InstanceTransferChunks.exportPart")(function* (
    this: InstanceTransferChunks,
    exportId: string,
    index: number,
    owner: string,
  ): Effect.fn.Return<InstanceTransferExportPart, ArchiveOperationError> {
    const entry = this.#exports.get(exportId);
    if (!entry || entry.owner !== owner) return yield* closed();
    if (!Number.isSafeInteger(index) || index < 0 || index >= partCount(entry.size)) return yield* invalidPart();
    entry.timer.refresh();
    return {
      path: entry.path,
      start: index * INSTANCE_TRANSFER_CHUNK_BYTES,
      length: partLength(entry.size, index),
    };
  }).bind(this);

  readonly finishExport = Effect.fn("InstanceTransferChunks.finishExport")(function* (
    this: InstanceTransferChunks,
    exportId: string,
    owner: string,
  ) {
    const entry = this.#exports.get(exportId);
    if (entry && entry.owner === owner) yield* this.#dropExport(entry);
  }).bind(this);

  #uploadState(upload: Upload): InstanceTransferUploadState {
    return {
      uploadId: upload.id,
      chunkBytes: INSTANCE_TRANSFER_CHUNK_BYTES,
      received: [...upload.received].sort((a, b) => a - b),
    };
  }

  #finishedSize(uploadId: string, owner: string): number | null {
    const finished = this.#finishes.get(uploadId);
    return finished && finished.owner === owner ? finished.size : null;
  }

  #ownUpload(uploadId: string, owner: string): Effect.Effect<Upload, ArchiveOperationError> {
    const upload = this.#uploads.get(uploadId);
    return upload && upload.owner === owner ? Effect.succeed(upload) : Effect.fail(closed());
  }

  #dropUpload(upload: Upload) {
    this.#uploads.delete(upload.id);
    clearTimeout(upload.timer);
    return archiveCall(() => rm(upload.path, { force: true })).pipe(Effect.ignore);
  }

  #dropExport(entry: Export) {
    this.#exports.delete(entry.id);
    clearTimeout(entry.timer);
    return archiveCall(() => rm(entry.path, { force: true })).pipe(Effect.ignore);
  }
}
