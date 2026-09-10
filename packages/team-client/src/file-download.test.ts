import {
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { describe, expect, it } from "vitest";
import { createRemoteFileReceiver } from "./file-download";
import { createRemoteFileSender, MOBILE_ATTACHMENT_BYTES } from "./file-upload";

const transferId = "b6396068-3405-4e51-9b42-d97bfd1e2f33";
const open = {
  version: 2,
  type: "file-open",
  transferId,
  name: "hello.txt",
  mimeType: "text/plain",
  size: 5,
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
} as const;

describe("mobile attachment downloads", () => {
  it("receives exact bytes when the RPC response arrives before the file channel", async () => {
    const receiver = createRemoteFileReceiver(async (data) => sender.receive(data));
    const sender = createRemoteFileSender(
      async (data) => {
        await receiver.receive(data);
      },
      () => transferId,
    );
    const downloaded = receiver.take(transferId);
    await sender.upload({ name: "data.json", mimeType: "application/json", base64: btoa('{"value":1}') });
    await expect(downloaded).resolves.toEqual({
      name: "data.json",
      mimeType: "application/json",
      base64: btoa('{"value":1}'),
    });
    receiver.clear();
  });
  it("rejects incomplete, damaged and out-of-order files before exposing bytes", async () => {
    const receiver = createRemoteFileReceiver(async () => {});
    await receiver.receive(encodeTeamProtocolV2Frame(open));
    await expect(
      receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId })),
    ).rejects.toThrow("incomplete");
    await expect(
      receiver.receive(
        new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId, offset: 1, bytes: new Uint8Array([1]) })).buffer,
      ),
    ).rejects.toThrow("invalid attachment chunk");
    await receiver.receive(
      new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId, offset: 0, bytes: new TextEncoder().encode("wrong") }))
        .buffer,
    );
    await expect(
      receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId })),
    ).rejects.toThrow("damaged");
    receiver.clear();
  });
  it("refuses oversized downloads and rejects waiting callers on disconnect", async () => {
    const frames: string[] = [];
    const receiver = createRemoteFileReceiver(async (data) => {
      frames.push(data);
    });
    await receiver.receive(encodeTeamProtocolV2Frame({ ...open, size: MOBILE_ATTACHMENT_BYTES + 1 }));
    expect(frames.map(decodeTeamProtocolV2FileControlFrame)).toEqual([
      {
        version: 2,
        type: "file-cancel",
        transferId,
        reason: "Attachments must be 10 MB or smaller. Download fewer files at once.",
      },
    ]);
    const result = receiver.take(transferId);
    receiver.clear();
    await expect(result).rejects.toThrow("connection closed");
  });
});
