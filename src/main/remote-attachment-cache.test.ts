import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { type RemoteAttachment, RemoteAttachmentCache } from "./remote-attachment-cache";
import { remoteCall } from "./remote-service-effects";

function attachment(label: string, size = 4): RemoteAttachment {
  return { bytes: new Uint8Array(size).fill(label.charCodeAt(0)), name: label, mimeType: "image/png" };
}

describe("RemoteAttachmentCache", () => {
  it("downloads a file once for each server, and again after the time limit", async () => {
    let now = 0;
    const cache = new RemoteAttachmentCache(() => now);
    const download = vi.fn(async () => attachment("a"));
    const other = vi.fn(async () => attachment("b"));

    await Promise.all([
      runCauseEffect(cache.get("one", "file", () => remoteCall(download))),
      runCauseEffect(cache.get("one", "file", () => remoteCall(download))),
    ]);
    await expect(runCauseEffect(cache.get("one", "file", () => remoteCall(download)))).resolves.toMatchObject({
      name: "a",
    });
    await expect(runCauseEffect(cache.get("two", "file", () => remoteCall(other)))).resolves.toMatchObject({
      name: "b",
    });
    expect(download).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();

    now = 10 * 60_000;
    await runCauseEffect(cache.get("one", "file", () => remoteCall(download)));
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("does not keep a file from a server that it forgot, also when the download ends later", async () => {
    const cache = new RemoteAttachmentCache();
    let finish: (value: RemoteAttachment) => void = () => undefined;
    const slow = vi.fn(() => new Promise<RemoteAttachment>((resolve) => (finish = resolve)));
    const pending = runCauseEffect(cache.get("one", "late", () => remoteCall(slow)));
    await runCauseEffect(cache.get("one", "early", () => remoteCall(async () => attachment("e"))));

    cache.forget("one");
    finish(attachment("l"));
    await pending;

    const again = vi.fn(async () => attachment("x"));
    await runCauseEffect(cache.get("one", "late", () => remoteCall(again)));
    await runCauseEffect(cache.get("one", "early", () => remoteCall(again)));
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed download", async () => {
    const cache = new RemoteAttachmentCache();
    await expect(
      runCauseEffect(cache.get("one", "file", () => remoteCall(async () => Promise.reject(new Error("offline"))))),
    ).rejects.toThrow("offline");
    const download = vi.fn(async () => attachment("a"));
    await runCauseEffect(cache.get("one", "file", () => remoteCall(download)));
    expect(download).toHaveBeenCalledOnce();
  });

  it("removes the least recently used file to stay in its byte budget", async () => {
    const cache = new RemoteAttachmentCache();
    const megabytes = 16 * 1024 * 1024;
    for (const id of ["a", "b", "c", "d"])
      await runCauseEffect(cache.get("one", id, () => remoteCall(async () => attachment(id, megabytes))));
    await runCauseEffect(cache.get("one", "a", () => remoteCall(async () => attachment("a"))));
    await runCauseEffect(cache.get("one", "e", () => remoteCall(async () => attachment("e", megabytes))));

    const download = vi.fn(async () => attachment("z"));
    await runCauseEffect(cache.get("one", "a", () => remoteCall(download)));
    expect(download).not.toHaveBeenCalled();
    await runCauseEffect(cache.get("one", "b", () => remoteCall(download)));
    expect(download).toHaveBeenCalledOnce();
  });
});
