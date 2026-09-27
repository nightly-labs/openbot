import { describe, expect, it, vi } from "vitest";
import { type RemoteAttachment, RemoteAttachmentCache } from "./remote-attachment-cache";

function attachment(label: string, size = 4): RemoteAttachment {
  return { bytes: new Uint8Array(size).fill(label.charCodeAt(0)), name: label, mimeType: "image/png" };
}

describe("RemoteAttachmentCache", () => {
  it("downloads a file once for each server, and again after the time limit", async () => {
    let now = 0;
    const cache = new RemoteAttachmentCache(() => now);
    const download = vi.fn(async () => attachment("a"));
    const other = vi.fn(async () => attachment("b"));

    await Promise.all([cache.get("one", "file", download), cache.get("one", "file", download)]);
    await expect(cache.get("one", "file", download)).resolves.toMatchObject({ name: "a" });
    await expect(cache.get("two", "file", other)).resolves.toMatchObject({ name: "b" });
    expect(download).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();

    now = 10 * 60_000;
    await cache.get("one", "file", download);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("does not keep a file from a server that it forgot, also when the download ends later", async () => {
    const cache = new RemoteAttachmentCache();
    let finish: (value: RemoteAttachment) => void = () => undefined;
    const slow = vi.fn(() => new Promise<RemoteAttachment>((resolve) => (finish = resolve)));
    const pending = cache.get("one", "late", slow);
    await cache.get("one", "early", async () => attachment("e"));

    cache.forget("one");
    finish(attachment("l"));
    await pending;

    const again = vi.fn(async () => attachment("x"));
    await cache.get("one", "late", again);
    await cache.get("one", "early", again);
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed download", async () => {
    const cache = new RemoteAttachmentCache();
    await expect(cache.get("one", "file", async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    const download = vi.fn(async () => attachment("a"));
    await cache.get("one", "file", download);
    expect(download).toHaveBeenCalledOnce();
  });

  it("removes the least recently used file to stay in its byte budget", async () => {
    const cache = new RemoteAttachmentCache();
    const megabytes = 16 * 1024 * 1024;
    for (const id of ["a", "b", "c", "d"]) await cache.get("one", id, async () => attachment(id, megabytes));
    await cache.get("one", "a", async () => attachment("a"));
    await cache.get("one", "e", async () => attachment("e", megabytes));

    const download = vi.fn(async () => attachment("z"));
    await cache.get("one", "a", download);
    expect(download).not.toHaveBeenCalled();
    await cache.get("one", "b", download);
    expect(download).toHaveBeenCalledOnce();
  });
});
