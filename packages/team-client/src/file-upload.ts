import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";

// Native/DOM bridge copies Base64 strings. Keep its working set below the host's larger file limit.
export const MOBILE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export interface RemoteFileUpload {
  name: string;
  mimeType: string;
  base64: string;
}

export function createRemoteFileSender(send: (data: string | ArrayBuffer) => Promise<void>, createId: () => string) {
  const pending = new Map<string, { opened: () => void; reject: (error: Error) => void; error: Error | null }>();
  return {
    receive(data: string) {
      const frame = decodeTeamProtocolV2FileControlFrame(data);
      const transfer = pending.get(frame.transferId);
      if (!transfer) return;
      if (frame.type === "file-ack") transfer.opened();
      if (frame.type === "file-cancel") {
        transfer.error = new Error("The host rejected the attachment.");
        transfer.reject(transfer.error);
      }
    },
    cancel() {
      for (const transfer of pending.values()) {
        transfer.error = new Error("The attachment connection closed.");
        transfer.reject(transfer.error);
      }
      pending.clear();
    },
    async upload(input: RemoteFileUpload) {
      if (input.base64.length > Math.ceil(MOBILE_ATTACHMENT_BYTES / 3) * 4)
        throw new Error("Attachments must be 10 MB or smaller.");
      const decoded = atob(input.base64);
      const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      if (bytes.length > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
      if (pending.size !== 0) throw new Error("Wait for the current attachment to finish.");
      const transferId = createId();
      let opened = () => {};
      let reject = (_error: Error) => {};
      const acknowledged = new Promise<void>((resolve, fail) => {
        opened = resolve;
        reject = fail;
      });
      const transfer: { opened: () => void; reject: (error: Error) => void; error: Error | null } = {
        opened,
        reject,
        error: null,
      };
      pending.set(transferId, transfer);
      const timer = setTimeout(() => {
        transfer.error = new Error("The attachment upload timed out.");
        reject(transfer.error);
      }, 60_000);
      try {
        // Observe rejection before starting I/O, including a synchronous native disconnect.
        await Promise.all([
          acknowledged,
          send(
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-open",
              transferId,
              name: input.name,
              mimeType: input.mimeType,
              size: bytes.length,
              sha256: Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
            }),
          ),
        ]);
        for (let offset = 0; offset < bytes.length; offset += 60 * 1024) {
          if (transfer.error) throw transfer.error;
          const chunk = encodeTeamProtocolV2FileChunk({
            transferId,
            offset,
            bytes: bytes.slice(offset, offset + 60 * 1024),
          });
          await send(new Uint8Array(chunk).buffer);
        }
        if (transfer.error) throw transfer.error;
        await send(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }));
        return transferId;
      } finally {
        clearTimeout(timer);
        pending.delete(transferId);
      }
    },
  };
}
