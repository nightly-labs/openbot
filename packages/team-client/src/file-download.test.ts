import {
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTeamEffect } from "./effect-boundary";
import { createRemoteFileReceiver } from "./file-download";
import {
  createRemoteFileSender,
  type FileTransferError,
  fileTransferError,
  MOBILE_ATTACHMENT_BYTES,
} from "./file-upload";

afterEach(() => vi.useRealTimers());

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
    const receiver = createRemoteFileReceiver(
      (data: string): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({
          try: () => (async (data: string) => sender.receive(data))(data),
          catch: fileTransferError,
        }),
    );
    const sender = createRemoteFileSender(
      (data: string | ArrayBuffer): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({
          try: () =>
            (async (data: string | ArrayBuffer) => {
              await runTeamEffect(receiver.receive(data));
            })(data),
          catch: fileTransferError,
        }),
      () => transferId,
    );
    const downloaded = runTeamEffect(receiver.take(transferId));
    await runTeamEffect(
      sender.upload({ name: "data.json", mimeType: "application/json", base64: btoa('{"value":1}') }),
    );
    await expect(downloaded).resolves.toEqual({
      name: "data.json",
      mimeType: "application/json",
      base64: btoa('{"value":1}'),
    });
    receiver.clear();
  });
  it("rejects incomplete, damaged and out-of-order files before exposing bytes", async () => {
    const receiver = createRemoteFileReceiver(
      (_data: string): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({ try: () => (async () => {})(), catch: fileTransferError }),
    );
    await runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame(open)));
    await expect(
      runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }))),
    ).rejects.toThrow("incomplete");
    await expect(
      runTeamEffect(
        receiver.receive(
          new Uint8Array(encodeTeamProtocolV2FileChunk({ transferId, offset: 1, bytes: new Uint8Array([1]) })).buffer,
        ),
      ),
    ).rejects.toThrow("invalid attachment chunk");
    await runTeamEffect(
      receiver.receive(
        new Uint8Array(
          encodeTeamProtocolV2FileChunk({ transferId, offset: 0, bytes: new TextEncoder().encode("wrong") }),
        ).buffer,
      ),
    );
    await expect(
      runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }))),
    ).rejects.toThrow("damaged");
    receiver.clear();
  });
  it("refuses oversized downloads and rejects waiting callers on disconnect", async () => {
    const frames: string[] = [];
    const receiver = createRemoteFileReceiver(
      (data: string): Effect.Effect<void, FileTransferError> =>
        Effect.tryPromise({
          try: () =>
            (async (data: string) => {
              frames.push(data);
            })(data),
          catch: fileTransferError,
        }),
    );
    await runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame({ ...open, size: MOBILE_ATTACHMENT_BYTES + 1 })));
    expect(frames.map(decodeTeamProtocolV2FileControlFrame)).toEqual([
      {
        version: 2,
        type: "file-cancel",
        transferId,
        reason: "Attachments must be 10 MB or smaller. Download fewer files at once.",
      },
    ]);
    const result = runTeamEffect(receiver.take(transferId));
    receiver.clear();
    await expect(result).rejects.toThrow("connection closed");
  });
});

it("keeps a progressing download alive beyond sixty seconds", async () => {
  vi.useFakeTimers();
  const receiver = createRemoteFileReceiver(
    (_data: string): Effect.Effect<void, FileTransferError> =>
      Effect.tryPromise({ try: () => (async () => {})(), catch: fileTransferError }),
  );
  const result = runTeamEffect(receiver.take(transferId));
  const checked = expect(result).resolves.toMatchObject({ base64: btoa("hello") });
  await runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame(open)));
  for (let offset = 0; offset < 5; offset++) {
    await vi.advanceTimersByTimeAsync(30_000);
    await runTeamEffect(
      receiver.receive(
        new Uint8Array(
          encodeTeamProtocolV2FileChunk({
            transferId,
            offset,
            bytes: new TextEncoder().encode("hello"[offset]),
          }),
        ).buffer,
      ),
    );
  }
  await runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId })));
  await checked;
  receiver.clear();
});

it("rejects an idle download and cancels late chunks without a protocol error", async () => {
  vi.useFakeTimers();
  const frames: string[] = [];
  const receiver = createRemoteFileReceiver(
    (data: string): Effect.Effect<void, FileTransferError> =>
      Effect.tryPromise({
        try: () =>
          (async (data: string) => {
            frames.push(data);
          })(data),
        catch: fileTransferError,
      }),
  );
  await runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame(open)));
  const checked = expect(runTeamEffect(receiver.take(transferId))).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(60_000);
  await checked;
  await runTeamEffect(
    receiver.receive(
      new Uint8Array(
        encodeTeamProtocolV2FileChunk({
          transferId,
          offset: 0,
          bytes: new TextEncoder().encode("hello"),
        }),
      ).buffer,
    ),
  );
  expect(decodeTeamProtocolV2FileControlFrame(frames.at(-1) ?? "")).toMatchObject({ type: "file-cancel", transferId });
  await expect(
    runTeamEffect(receiver.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }))),
  ).resolves.toBe(true);
  receiver.clear();
});
