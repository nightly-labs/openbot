import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireWebHostLock } from "./web-host-lock";

afterEach(() => vi.unstubAllGlobals());
describe("browser host ownership", () => {
  it("refuses a second tab for the same account and host, then permits it after release", async () => {
    const held = new Set<string>();
    const request = vi.fn(
      async (
        name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: { name: string; mode: "exclusive" } | null) => Promise<void>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name, mode: "exclusive" });
        } finally {
          held.delete(name);
        }
      },
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const release = await acquireWebHostLock("one", "host");
    await expect(acquireWebHostLock("one", "host")).rejects.toThrow("another tab");
    const otherAccount = await acquireWebHostLock("two", "host");
    const otherHost = await acquireWebHostLock("one", "other-host");
    release();
    await vi.waitFor(() => expect(held.has("openbot.web.host:one:host")).toBe(false));
    const next = await acquireWebHostLock("one", "host");
    next();
    otherAccount();
    otherHost();
    await vi.waitFor(() => expect(held.size).toBe(0));
  });
  it("refuses connection when the browser has no lock manager", async () => {
    vi.stubGlobal("navigator", {});
    await expect(acquireWebHostLock("one", "host")).rejects.toThrow("cannot protect");
  });
});
