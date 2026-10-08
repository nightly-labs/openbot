// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteSessionCache, type RemoteSessionCacheOptions } from "./remote-session-cache";

const SIGNAL_URL = "wss://signal.example.test/v1/signal";
const session = { sessionId: "session-secret-1", expiresAt: 8_640_000_000_000_000 };
// Not encryption, but enough to show that the file never holds the plain JSON.
const mask = (value: Buffer): Buffer => Buffer.from(Array.from(value, (byte) => byte ^ 0x5a));
const cipher = {
  encrypt: (value: string): Buffer => mask(Buffer.from(value, "utf8")),
  decrypt: (value: Buffer): string => mask(value).toString("utf8"),
};
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function cachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-remote-sessions-"));
  directories.push(directory);
  return join(directory, "openbot-remote-sessions-v1.bin");
}

function createCache(path: string, overrides: Partial<RemoteSessionCacheOptions> = {}): RemoteSessionCache {
  return new RemoteSessionCache({ path, canPersist: () => true, ...cipher, ...overrides });
}

async function loaded(path: string, overrides: Partial<RemoteSessionCacheOptions> = {}) {
  const cache = createCache(path, overrides);
  await Effect.runPromise(cache.load());
  return cache;
}

describe("RemoteSessionCache", () => {
  it("keeps a session for the next run, encrypted, and only for the same account", async () => {
    const path = await cachePath();
    await Effect.runPromise(createCache(path).set("user-1", "host-1", session, SIGNAL_URL));

    const file = await readFile(path, "utf8");
    expect(file).not.toContain("session-secret-1");
    expect(Buffer.from(file, "base64").toString("utf8")).not.toContain("session-secret-1");

    const next = await loaded(path);
    expect(next.get("user-1", "host-1")).toEqual(session);
    expect(next.signalUrl("user-1")).toBe(SIGNAL_URL);
    expect(next.get("user-2", "host-1")).toBeNull();
    expect(next.signalUrl("user-2")).toBeNull();

    // Another account replaces the file: the first account's sessions are gone.
    await Effect.runPromise(next.set("user-2", "host-2", { ...session, sessionId: "session-2" }, SIGNAL_URL));
    const after = await loaded(path);
    expect(after.get("user-1", "host-1")).toBeNull();
    expect(after.get("user-2", "host-2")?.sessionId).toBe("session-2");
  });

  it("forgets one host, and removes the file at sign-out", async () => {
    const path = await cachePath();
    const cache = createCache(path);
    await Effect.runPromise(cache.set("user-1", "host-1", session, SIGNAL_URL));
    await Effect.runPromise(cache.set("user-1", "host-2", { ...session, sessionId: "session-2" }, SIGNAL_URL));
    await Effect.runPromise(cache.delete("host-1"));
    const next = await loaded(path);
    expect(next.get("user-1", "host-1")).toBeNull();
    expect(next.get("user-1", "host-2")?.sessionId).toBe("session-2");

    await Effect.runPromise(next.clear());
    expect(next.get("user-1", "host-2")).toBeNull();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes nothing, and removes an old file, when the storage protection is unavailable", async () => {
    const path = await cachePath();
    await Effect.runPromise(createCache(path).set("user-1", "host-1", session, SIGNAL_URL));
    const cache = createCache(path, { canPersist: () => false });
    expect(cache.canPersist()).toBe(false);
    await Effect.runPromise(cache.set("user-1", "host-2", session, SIGNAL_URL));
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads an unreadable file as empty, and an address that is not Signal's as none", async () => {
    const path = await cachePath();
    await writeFile(path, "not base64 of anything");
    expect((await loaded(path)).get("user-1", "host-1")).toBeNull();
    expect((await loaded(path, { decrypt: () => "{" })).get("user-1", "host-1")).toBeNull();
    const thrown = await loaded(path, {
      decrypt: () => {
        throw new Error("The keychain is locked.");
      },
    });
    expect(thrown.get("user-1", "host-1")).toBeNull();

    await writeFile(
      path,
      cipher
        .encrypt(
          JSON.stringify({
            version: 1,
            principalId: "user-1",
            signalUrl: "https://elsewhere.example.test/",
            sessions: { "host-1": session, "host-2": { sessionId: 7 } },
          }),
        )
        .toString("base64"),
    );
    const partial = await loaded(path);
    expect(partial.get("user-1", "host-1")).toEqual(session);
    expect(partial.get("user-1", "host-2")).toBeNull();
    expect(partial.signalUrl("user-1")).toBeNull();
  });
});
