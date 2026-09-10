import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "./file-upload";

interface Download {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  received: number;
  digest: string;
  complete: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/** Receives the released file protocol; bytes are exposed only after digest validation. */
export function createRemoteFileReceiver(send: (data: string) => Promise<void>) {
  const downloads = new Map<string, Download>();
  const waiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  function remove(id: string) {
    const entry = downloads.get(id);
    if (entry) clearTimeout(entry.timer);
    downloads.delete(id);
  }
  function expire(id: string) {
    remove(id);
    const waiter = waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(id);
      waiter.reject(new Error("The attachment download timed out. Try again."));
    }
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
  return {
    clear() {
      for (const id of downloads.keys()) remove(id);
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("The attachment connection closed."));
      }
      waiters.clear();
    },
    async take(id: string): Promise<RemoteFileUpload> {
      if (!downloads.get(id)?.complete) {
        if (waiters.has(id) || waiters.size >= 10) throw new Error("Too many attachment downloads.");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => expire(id), 60_000);
          waiters.set(id, { resolve, reject, timer });
        });
      }
      const entry = downloads.get(id);
      if (!entry?.complete) throw new Error("The attachment download is incomplete. Try again.");
      remove(id);
      const parts: string[] = [];
      for (let offset = 0; offset < entry.bytes.length; offset += 8192)
        parts.push(String.fromCharCode(...entry.bytes.subarray(offset, offset + 8192)));
      return { name: entry.name, mimeType: entry.mimeType, base64: btoa(parts.join("")) };
    },
    async receive(data: string | ArrayBuffer) {
      if (typeof data !== "string") {
        const chunk = decodeTeamProtocolV2FileChunk(data);
        const entry = downloads.get(chunk.transferId);
        // A timed-out transfer may still have chunks in flight. Cancel only that
        // transfer; an expired download must not invalidate the peer connection.
        if (!entry) {
          await send(
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-cancel",
              transferId: chunk.transferId,
              reason: "The attachment download is no longer active.",
            }),
          );
          return true;
        }
        if (entry.complete || chunk.offset !== entry.received || chunk.offset + chunk.bytes.length > entry.bytes.length)
          throw new Error("The host sent an invalid attachment chunk.");
        entry.bytes.set(chunk.bytes, chunk.offset);
        entry.received += chunk.bytes.length;
        if (chunk.bytes.length > 0) touch(chunk.transferId);
        await send(
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-ack",
            transferId: chunk.transferId,
            receivedThrough: entry.received,
          }),
        );
        return true;
      }
      const frame = decodeTeamProtocolV2FileControlFrame(data);
      if (frame.type === "file-open") {
        if (downloads.has(frame.transferId)) throw new Error("The host repeated an attachment transfer.");
        const total = [...downloads.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
        if (
          frame.size > MOBILE_ATTACHMENT_BYTES ||
          total + frame.size > MOBILE_ATTACHMENT_BYTES * 2 ||
          downloads.size >= 10
        ) {
          await send(
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-cancel",
              transferId: frame.transferId,
              reason: "Attachments must be 10 MB or smaller. Download fewer files at once.",
            }),
          );
          return true;
        }
        downloads.set(frame.transferId, {
          name: frame.name,
          mimeType: frame.mimeType,
          bytes: new Uint8Array(frame.size),
          received: 0,
          digest: frame.sha256,
          complete: false,
          timer: setTimeout(() => expire(frame.transferId), 60_000),
        });
        touch(frame.transferId);
        await send(
          encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId: frame.transferId, receivedThrough: 0 }),
        );
        return true;
      }
      if (frame.type === "file-complete") {
        const entry = downloads.get(frame.transferId);
        if (!entry) return true;
        if (entry.received !== entry.bytes.length) throw new Error("The attachment download is incomplete.");
        const digest = Array.from(sha256(entry.bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (digest !== entry.digest) {
          remove(frame.transferId);
          throw new Error("The attachment download is damaged. Try again.");
        }
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
      if (frame.type === "file-cancel" && downloads.has(frame.transferId)) {
        remove(frame.transferId);
        return true;
      }
      return false;
    },
  };
}
