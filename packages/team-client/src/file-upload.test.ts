import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runTeamEffect } from "./effect-boundary";
import { createRemoteFileSender, type FileTransferError, fileTransferError } from "./file-upload";

const transferId = "b6396068-3405-4e51-9b42-d97bfd1e2f33";
const input = { name: "note.txt", mimeType: "text/plain", base64: btoa("hello") };

describe("mobile file upload", () => {
  it("cancels an upload before acknowledgement and lets the next upload finish", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = createRemoteFileSender(
      (data: string | ArrayBuffer): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({ try: () => send(data), catch: fileTransferError }),
      () => transferId,
    );
    const uploading = runTeamEffect(sender.upload(input));
    const rejected = expect(uploading).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await runTeamEffect(sender.cancelUpload());
    await rejected;
    expect(decodeTeamProtocolV2FileControlFrame(send.mock.calls[1]?.[0])).toMatchObject({
      type: "file-cancel",
      transferId,
    });
    send.mockImplementation(async (data: string | ArrayBuffer) => {
      if (typeof data === "string" && decodeTeamProtocolV2FileControlFrame(data).type === "file-open")
        sender.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId, receivedThrough: 0 }));
    });
    await expect(runTeamEffect(sender.upload(input))).resolves.toBe(transferId);
  });
  it("sends the existing file protocol with the exact bytes and digest before completing", async () => {
    const received: Array<string | ArrayBuffer> = [];
    const sender = createRemoteFileSender(
      (data: string | ArrayBuffer): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({
          try: () =>
            (async (data: string | ArrayBuffer) => {
              received.push(data);
              if (typeof data === "string" && decodeTeamProtocolV2FileControlFrame(data).type === "file-open") {
                sender.receive(
                  encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId, receivedThrough: 0 }),
                );
              }
            })(data),
          catch: fileTransferError,
        }),
      () => transferId,
    );
    const progress: [number, number][] = [];
    await runTeamEffect(sender.upload(input, (sent, total) => progress.push([sent, total])));
    // Reported after the bytes left, so a person never sees more sent than the channel took.
    expect(progress).toEqual([[5, 5]]);
    expect(
      received.map((data) =>
        typeof data === "string" ? decodeTeamProtocolV2FileControlFrame(data) : decodeTeamProtocolV2FileChunk(data),
      ),
    ).toEqual([
      {
        version: 2,
        type: "file-open",
        transferId,
        name: "note.txt",
        mimeType: "text/plain",
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
      { transferId, offset: 0, bytes: new TextEncoder().encode("hello") },
      { version: 2, type: "file-complete", transferId },
    ]);
  });
  it("stops before sending bytes when the host rejects the file", async () => {
    let frames = 0;
    const sender = createRemoteFileSender(
      (_data: string | ArrayBuffer): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({
          try: () =>
            (async () => {
              frames++;
              sender.receive(
                encodeTeamProtocolV2Frame({ version: 2, type: "file-cancel", transferId, reason: "rejected" }),
              );
            })(),
          catch: fileTransferError,
        }),
      () => transferId,
    );
    await expect(runTeamEffect(sender.upload(input))).rejects.toThrow("The host rejected the attachment.");
    expect(frames).toBe(1);
  });
  it("rejects a pending upload when its connection is replaced", async () => {
    const sender = createRemoteFileSender(
      (_data: string | ArrayBuffer): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({ try: () => (async () => sender.cancel())(), catch: fileTransferError }),
      () => transferId,
    );
    await expect(runTeamEffect(sender.upload(input))).rejects.toThrow("The attachment connection closed.");
  });
});
