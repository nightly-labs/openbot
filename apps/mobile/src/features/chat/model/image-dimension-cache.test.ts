import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageDimensionCache } from "./image-dimension-cache";

afterEach(() => {
  vi.useRealTimers();
});

describe("saved image sizes", () => {
  it("keeps a measured size for the next launch, so a history image does not resize as it loads", async () => {
    vi.useFakeTimers();
    let saved: string | null = null;
    const storage = { read: () => saved, write: (text: string) => (saved = text) };
    const first = createImageDimensionCache(storage);
    first.remember("host-image", { width: 1600, height: 900 });
    // A draft ID names another file next session, so it stays in memory only.
    first.remember("mobile-draft-attachment-1", { width: 10, height: 10 });
    await vi.advanceTimersByTimeAsync(1_000);
    const next = createImageDimensionCache(storage);
    expect(next.get("host-image")).toEqual({ width: 1600, height: 900 });
    expect(next.get("mobile-draft-attachment-1")).toBeNull();
  });

  it("ignores saved data it cannot trust instead of breaking the chat", () => {
    const cache = createImageDimensionCache({
      read: () => JSON.stringify([["good", 4, 3], ["negative", -1, 3], ["text", "4", 3], "junk"]),
      write: () => {},
    });
    expect(cache.get("good")).toEqual({ width: 4, height: 3 });
    expect(cache.get("negative")).toBeNull();
    expect(cache.get("text")).toBeNull();
    const broken = createImageDimensionCache({
      read: () => {
        throw new Error("unreadable");
      },
      write: () => {},
    });
    expect(broken.get("good")).toBeNull();
  });
});
