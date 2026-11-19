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
  /**
   * The hash and the Base64 grow with each chunk, so a large file is ready when its last byte
   * arrives. Hashing and encoding 40 MB at the end kept the file waiting for seconds.
   */
  hash: ReturnType<typeof sha256.create>;
  base64: string[];
  /** The last bytes that do not fill a group of three, for the next chunk's Base64. */
  carry: Uint8Array;
  digest: string;
  complete: boolean;
  /** An allowed larger file. It does not count against the attachment total. */
  allowed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface DownloadAllowance {
  maxBytes: number;
  /** Without a type, the allowance takes a larger file of any type. */
  mimeType: string | undefined;
  taken: boolean;
}

interface DownloadWatch {
  size: number;
  onProgress: (received: number, size: number) => void;
  transferId: string | null;
}

/** Receives the released file protocol; bytes are exposed only after digest validation. */
export function createRemoteFileReceiver<E, R>(send: (data: string) => Effect.Effect<void, E, R>) {
  const downloads = new Map<string, Download>();
  // Requests that wait for one file larger than an attachment, such as a transfer file. Each one
  // takes the first larger file of its type that fits it, and it ends with its request.
  const allowances = new Set<DownloadAllowance>();
  const waiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  // The reason of each file that ended before its request read it. The host sends the file before it
  // answers the request, so a refused file usually has no waiter yet. Its request then fails with this
  // reason at once, not with a timeout a minute later.
  const ended = new Map<string, string>();
  // Requests that report the progress of their file. The host names a file only in its answer, after
  // the last byte, so the size ties a file to its request. Two files of one size can swap their
  // progress; their bytes still go to the request that the answer names.
  const watches = new Set<DownloadWatch>();
  function report(id: string, received: number, size: number) {
    for (const watch of watches) if (watch.transferId === id) watch.onProgress(received, size);
  }
  function remove(id: string) {
    const entry = downloads.get(id);
    if (entry) clearTimeout(entry.timer);
    downloads.delete(id);
  }
  /** Ends the download and the request that waits for it, so the request does not wait for the timeout. */
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
      // A timed-out transfer may still have chunks in flight. Cancel only that
      // transfer; an expired download must not invalidate the peer connection.
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
      // A chunk joins the carry of the chunk before only when there is one, so a usual chunk is not copied.
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
        // A request can wait for this file before it starts. It ends now, not at the timeout. A request
        // that allows a larger file gets the limit that it allows.
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
    // A cancel can come before the file starts, while a request already waits for it.
    if (frame.type === "file-cancel" && (downloads.has(frame.transferId) || waiters.has(frame.transferId))) {
      fail(frame.transferId, sourceText("error.remote.downloadStopped"));
      return true;
    }
    return false;
  });
  return {
    /**
     * Lets one file of `mimeType` (any type without it) and up to `maxBytes` arrive while a request waits for it. Call the
     * answer when the request ends; a file still arriving then keeps its place.
     */
    allow(maxBytes: number, mimeType?: string) {
      const allowance: DownloadAllowance = { maxBytes, mimeType, taken: false };
      allowances.add(allowance);
      return () => {
        allowances.delete(allowance);
      };
    },
    /**
     * Reports the bytes of the next file of `size` that the host opens. Call the answer when the
     * request ends. Progress never changes the download.
     */
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
