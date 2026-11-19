import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { bytesToBase64 } from "./base64";
import { FileTransferError, fileTransferError, MOBILE_ATTACHMENT_BYTES } from "./file-upload";

function transferFailure(message: string): FileTransferError {
  return new FileTransferError({ message });
}

interface Download {
  name: string;
  mimeType: string;
  size: number;
  received: number;
  hash: ReturnType<typeof sha256.create>;
  base64: string[];
  carry: Uint8Array;
  digest: string;
  complete: boolean;
  allowed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface DownloadAllowance {
  maxBytes: number;
  mimeType: string | undefined;
  taken: boolean;
}

interface DownloadWatch {
  size: number;
  onProgress: (received: number, size: number) => void;
  transferId: string | null;
}

export function createRemoteFileReceiver<E, R>(send: (data: string) => Effect.Effect<void, E, R>) {
  const downloads = new Map<string, Download>();
  const allowances = new Set<DownloadAllowance>();
  const waiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const ended = new Map<string, string>();
  const watches = new Set<DownloadWatch>();
  function report(id: string, received: number, size: number) {
    for (const watch of watches) if (watch.transferId === id) watch.onProgress(received, size);
  }
  function remove(id: string) {
    const entry = downloads.get(id);
    if (entry) clearTimeout(entry.timer);
    downloads.delete(id);
  }
  function fail(id: string, message: string) {
    remove(id);
    const waiter = waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(id);
      waiter.reject(new Error(message));
      return;
    }
    ended.set(id, message);
    for (const old of ended.keys()) {
      if (ended.size <= 32) break;
      ended.delete(old);
    }
  }
  function expire(id: string) {
    fail(id, sourceText("error.remote.downloadTimeout"));
  }
  function touch(id: string) {
    const entry = downloads.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => expire(id), 60_000);
    }
    const waiter = waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.timer = setTimeout(() => expire(id), 60_000);
    }
  }
  const sendFrame = (data: string) => send(data).pipe(Effect.mapError(fileTransferError));
  const take = Effect.fn("RemoteFileReceiver.take")(function* (id: string) {
    const reason = ended.get(id);
    if (reason !== undefined) {
      ended.delete(id);
      return yield* transferFailure(reason);
    }
    if (!downloads.get(id)?.complete) {
      if (waiters.has(id) || waiters.size >= 10)
        return yield* transferFailure(sourceText("error.remote.tooManyDownloads"));
      yield* Effect.callback<void, FileTransferError>((resume) => {
        const timer = setTimeout(() => expire(id), 60_000);
        const waiter = {
          resolve: () => resume(Effect.void),
          reject: (error: Error) => resume(Effect.fail(fileTransferError(error))),
          timer,
        };
        waiters.set(id, waiter);
        return Effect.sync(() => {
          clearTimeout(timer);
          if (waiters.get(id) === waiter) waiters.delete(id);
        });
      });
    }
    const entry = downloads.get(id);
    if (!entry?.complete) return yield* transferFailure(sourceText("error.remote.downloadIncompleteRetry"));
    remove(id);
    return { name: entry.name, mimeType: entry.mimeType, base64: entry.base64.join("") };
  });
  const receive = Effect.fn("RemoteFileReceiver.receive")(function* (data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      const chunk = yield* Effect.try({ try: () => decodeTeamProtocolV2FileChunk(data), catch: fileTransferError });
      const entry = downloads.get(chunk.transferId);
      if (!entry) {
        yield* sendFrame(
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-cancel",
            transferId: chunk.transferId,
            reason: "The attachment download is no longer active.",
          }),
        );
        return true;
      }
      if (entry.complete || chunk.offset !== entry.received || chunk.offset + chunk.bytes.length > entry.size)
        return yield* transferFailure("The host sent an invalid attachment chunk.");
      entry.received += chunk.bytes.length;
      entry.hash.update(chunk.bytes);
      let pending = chunk.bytes;
      if (entry.carry.length > 0) {
        pending = new Uint8Array(entry.carry.length + chunk.bytes.length);
        pending.set(entry.carry);
        pending.set(chunk.bytes, entry.carry.length);
      }
      const whole = pending.length - (pending.length % 3);
      entry.base64.push(bytesToBase64(pending.subarray(0, whole)));
      entry.carry = pending.slice(whole);
      if (chunk.bytes.length > 0) touch(chunk.transferId);
      report(chunk.transferId, entry.received, entry.size);
      yield* sendFrame(
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "file-ack",
          transferId: chunk.transferId,
          receivedThrough: entry.received,
        }),
      );
      return true;
    }
    const frame = yield* Effect.try({
      try: () => decodeTeamProtocolV2FileControlFrame(data),
      catch: fileTransferError,
    });
    if (frame.type === "file-open") {
      if (downloads.has(frame.transferId)) return yield* transferFailure("The host repeated an attachment transfer.");
      const total = [...downloads.values()]
        .filter((entry) => !entry.allowed)
        .reduce((sum, entry) => sum + entry.size, 0);
      const open = [...allowances].filter(
        (entry) => !entry.taken && (entry.mimeType === undefined || entry.mimeType === frame.mimeType),
      );
      const allowance =
        frame.size > MOBILE_ATTACHMENT_BYTES ? open.find((entry) => frame.size <= entry.maxBytes) : undefined;
      if (allowance) allowance.taken = true;
      else if (
        frame.size > MOBILE_ATTACHMENT_BYTES ||
        total + frame.size > MOBILE_ATTACHMENT_BYTES * 2 ||
        downloads.size >= 10
      ) {
        yield* sendFrame(
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-cancel",
            transferId: frame.transferId,
            reason: "Attachments must be 10 MB or smaller. Download fewer files at once.",
          }),
        );
        fail(
          frame.transferId,
          sourceText(
            frame.size <= MOBILE_ATTACHMENT_BYTES
              ? "error.remote.tooManyDownloads"
              : open.length > 0
                ? "error.remote.fileTooLarge"
                : "error.remote.attachmentTooLarge",
          ),
        );
        return true;
      }
      downloads.set(frame.transferId, {
        name: frame.name,
        mimeType: frame.mimeType,
        size: frame.size,
        received: 0,
        hash: sha256.create(),
        base64: [],
        carry: new Uint8Array(0),
        digest: frame.sha256,
        complete: false,
        allowed: allowance !== undefined,
        timer: setTimeout(() => expire(frame.transferId), 60_000),
      });
      touch(frame.transferId);
      const watch = [...watches].find((item) => item.transferId === null && item.size === frame.size);
      if (watch) {
        watch.transferId = frame.transferId;
        watch.onProgress(0, frame.size);
      }
      yield* sendFrame(
        encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId: frame.transferId, receivedThrough: 0 }),
      );
      return true;
    }
    if (frame.type === "file-complete") {
      const entry = downloads.get(frame.transferId);
      if (!entry) return true;
      if (entry.received !== entry.size) {
        fail(frame.transferId, sourceText("error.remote.downloadIncomplete"));
        return yield* transferFailure(sourceText("error.remote.downloadIncomplete"));
      }
      const digest = Array.from(entry.hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== entry.digest) {
        fail(frame.transferId, sourceText("error.remote.downloadDamaged"));
        return yield* transferFailure(sourceText("error.remote.downloadDamaged"));
      }
      if (entry.carry.length > 0) entry.base64.push(bytesToBase64(entry.carry));
      entry.carry = new Uint8Array(0);
      entry.complete = true;
      touch(frame.transferId);
      const waiter = waiters.get(frame.transferId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(frame.transferId);
        waiter.resolve();
      }
      return true;
    }
    if (frame.type === "file-cancel" && (downloads.has(frame.transferId) || waiters.has(frame.transferId))) {
      fail(frame.transferId, sourceText("error.remote.downloadStopped"));
      return true;
    }
    return false;
  });
  return {
    allow(maxBytes: number, mimeType?: string) {
      const allowance: DownloadAllowance = { maxBytes, mimeType, taken: false };
      allowances.add(allowance);
      return () => {
        allowances.delete(allowance);
      };
    },
    watch(size: number, onProgress: (received: number, size: number) => void) {
      const watch: DownloadWatch = { size, onProgress, transferId: null };
      watches.add(watch);
      return () => {
        watches.delete(watch);
      };
    },
    clear() {
      for (const id of downloads.keys()) remove(id);
      ended.clear();
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(sourceText("error.remote.attachmentConnectionClosed")));
      }
      waiters.clear();
    },
    take,
    receive,
  };
}
