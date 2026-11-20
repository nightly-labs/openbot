import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
  TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
} from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Schema } from "effect";

export class FileTransferError extends Schema.TaggedError<FileTransferError>()("FileTransferError", {
  message: Schema.String,
}) {}

export function fileTransferError(error: unknown): FileTransferError {
  return error instanceof FileTransferError
    ? error
    : new FileTransferError({
        message: error instanceof Error ? error.message : String(error),
      });
}

export const MOBILE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export type RemoteFileUpload = {
  name: string;
  mimeType: string;
  base64: string;
  maxBytes?: number;
  file?: { ref: string; size: number };
};

export type RemoteFileReader = {
  digest: (ref: string) => Effect.Effect<string, FileTransferError>;
  read: (ref: string, offset: number, length: number) => Effect.Effect<Uint8Array, FileTransferError>;
};

const CHUNK_BYTES = 60 * 1024;
const FILE_PART_BYTES = 16 * CHUNK_BYTES;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const MINIMUM_UPLOAD_RATE = 256;

export function createRemoteFileSender<E, R>(
  send: (data: string | ArrayBuffer) => Effect.Effect<void, E, R>,
  createId: () => string,
  reader?: RemoteFileReader,
) {
  const pending = new Map<string, { opened: () => void; reject: (error: Error) => void; error: Error | null }>();
  const sendFrame = (data: string | ArrayBuffer) => send(data).pipe(Effect.mapError(fileTransferError));
  const upload = Effect.fn("RemoteFileSender.upload")(function* (
    input: RemoteFileUpload,
    onProgress?: (sent: number, total: number) => void,
  ) {
    const busy = () => new FileTransferError({ message: sourceText("error.remote.attachmentBusy") });
    if (pending.size !== 0) return yield* busy();
    const source = yield* uploadSource(input);
    if (pending.size !== 0) return yield* busy();
    const transferId = createId();
    const acknowledged = Deferred.makeUnsafe<void, FileTransferError>();
    const opened = () => {
      Deferred.doneUnsafe(acknowledged, Effect.void);
    };
    const reject = (error: Error) => {
      Deferred.doneUnsafe(acknowledged, Effect.fail(fileTransferError(error)));
    };
    const transfer: { opened: () => void; reject: (error: Error) => void; error: Error | null } = {
      opened,
      reject,
      error: null,
    };
    pending.set(transferId, transfer);
    const timer = setTimeout(
      () => {
        transfer.error = new Error(sourceText("error.remote.uploadTimeout"));
        reject(transfer.error);
      },
      Math.max(60_000, source.size / MINIMUM_UPLOAD_RATE),
    );
    return yield* Effect.gen(function* () {
      yield* Effect.all(
        [
          Deferred.await(acknowledged),
          sendFrame(
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-open",
              transferId,
              name: input.name,
              mimeType: input.mimeType,
              size: source.size,
              sha256: source.sha256,
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      for (let partOffset = 0; partOffset < source.size; partOffset += FILE_PART_BYTES) {
        if (transfer.error) return yield* fileTransferError(transfer.error);
        const part = yield* source.read(partOffset, Math.min(FILE_PART_BYTES, source.size - partOffset));
        for (let index = 0; index < part.length; index += CHUNK_BYTES) {
          if (transfer.error) return yield* fileTransferError(transfer.error);
          const offset = partOffset + index;
          const chunk = encodeTeamProtocolV2FileChunk({
            transferId,
            offset,
            bytes: part.slice(index, index + CHUNK_BYTES),
          });
          yield* sendFrame(new Uint8Array(chunk).buffer);
          onProgress?.(Math.min(offset + CHUNK_BYTES, source.size), source.size);
        }
      }
      if (transfer.error) return yield* fileTransferError(transfer.error);
      yield* sendFrame(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }));
      return transferId;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          clearTimeout(timer);
          pending.delete(transferId);
        }),
      ),
    );
  });
  const uploadSource = Effect.fn("RemoteFileSender.source")(function* (input: RemoteFileUpload) {
    const tooLarge = () => new FileTransferError({ message: sourceText("error.remote.attachmentTooLarge") });
    const unavailable = () => new FileTransferError({ message: sourceText("error.remote.attachmentChanged") });
    const file = input.file;
    if (file) {
      if (!reader || !Number.isSafeInteger(file.size) || file.size < 0) return yield* unavailable();
      if (input.maxBytes !== undefined && file.size > input.maxBytes) return yield* tooLarge();
      if (file.size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES)
        return yield* new FileTransferError({ message: sourceText("error.remote.fileTooLarge") });
      const digest = yield* reader.digest(file.ref);
      if (!SHA256_HEX.test(digest)) return yield* unavailable();
      return {
        size: file.size,
        sha256: digest,
        read: (offset: number, length: number) =>
          reader
            .read(file.ref, offset, length)
            .pipe(Effect.filterOrFail((bytes) => bytes.length === length, unavailable)),
      };
    }
    const maxBytes = Math.min(input.maxBytes ?? MOBILE_ATTACHMENT_BYTES, TEAM_PROTOCOL_V2_MAX_FILE_BYTES);
    if (input.base64.length > Math.ceil(maxBytes / 3) * 4) return yield* tooLarge();
    const decoded = yield* Effect.try({ try: () => atob(input.base64), catch: fileTransferError });
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    if (bytes.length > maxBytes) return yield* tooLarge();
    return {
      size: bytes.length,
      sha256: Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      read: (offset: number, length: number) => Effect.succeed(bytes.subarray(offset, offset + length)),
    };
  });
  const cancelUpload = Effect.fn("RemoteFileSender.cancel")(function* () {
    for (const [transferId, transfer] of pending) {
      transfer.error = new FileTransferError({ message: sourceText("error.remote.uploadCancelled") });
      transfer.reject(transfer.error);
      yield* sendFrame(encodeTeamProtocolV2Frame({ version: 2, type: "file-cancel", transferId, reason: "Cancelled" }));
    }
  });
  return {
    upload,
    cancelUpload,
    receive(data: string) {
      const frame = decodeTeamProtocolV2FileControlFrame(data);
      const transfer = pending.get(frame.transferId);
      if (!transfer) return;
      if (frame.type === "file-ack") transfer.opened();
      if (frame.type === "file-cancel") {
        transfer.error = new Error(sourceText("error.remote.attachmentRejected"));
        transfer.reject(transfer.error);
      }
    },
    cancel() {
      for (const transfer of pending.values()) {
        transfer.error = new Error(sourceText("error.remote.attachmentConnectionClosed"));
        transfer.reject(transfer.error);
      }
      pending.clear();
    },
  };
}
