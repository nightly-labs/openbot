import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
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
      Effect.runPromise(
        cache.get("one", "file", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
      ),
      Effect.runPromise(
        cache.get("one", "file", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
      ),
    ]);
    await expect(
      Effect.runPromise(
        cache.get("one", "file", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toMatchObject({ name: "a" });
    await expect(
      Effect.runPromise(
        cache.get("two", "file", () => remoteCall(other)).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toMatchObject({ name: "b" });
    expect(download).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();

    now = 10 * 60_000;
    await Effect.runPromise(
      cache.get("one", "file", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("does not keep a file from a server that it forgot, also when the download ends later", async () => {
    const cache = new RemoteAttachmentCache();
    let finish: (value: RemoteAttachment) => void = () => undefined;
    const slow = vi.fn(() => new Promise<RemoteAttachment>((resolve) => (finish = resolve)));
    const pending = Effect.runPromise(
      cache.get("one", "late", () => remoteCall(slow)).pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      cache
        .get("one", "early", () => remoteCall(async () => attachment("e")))
        .pipe(Effect.mapError((error) => error.cause)),
    );

    cache.forget("one");
    finish(attachment("l"));
    await pending;

    const again = vi.fn(async () => attachment("x"));
    await Effect.runPromise(
      cache.get("one", "late", () => remoteCall(again)).pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      cache.get("one", "early", () => remoteCall(again)).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed download", async () => {
    const cache = new RemoteAttachmentCache();
    await expect(
      Effect.runPromise(
        cache
          .get("one", "file", () => remoteCall(async () => Promise.reject(new Error("offline"))))
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("offline");
    const download = vi.fn(async () => attachment("a"));
    await Effect.runPromise(
      cache.get("one", "file", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(download).toHaveBeenCalledOnce();
  });

  it("removes the least recently used file to stay in its byte budget", async () => {
    const cache = new RemoteAttachmentCache();
    const megabytes = 16 * 1024 * 1024;
    for (const id of ["a", "b", "c", "d"])
      await Effect.runPromise(
        cache
          .get("one", id, () => remoteCall(async () => attachment(id, megabytes)))
          .pipe(Effect.mapError((error) => error.cause)),
      );
    await Effect.runPromise(
      cache
        .get("one", "a", () => remoteCall(async () => attachment("a")))
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      cache
        .get("one", "e", () => remoteCall(async () => attachment("e", megabytes)))
        .pipe(Effect.mapError((error) => error.cause)),
    );

    const download = vi.fn(async () => attachment("z"));
    await Effect.runPromise(
      cache.get("one", "a", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(download).not.toHaveBeenCalled();
    await Effect.runPromise(
      cache.get("one", "b", () => remoteCall(download)).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(download).toHaveBeenCalledOnce();
  });
});
