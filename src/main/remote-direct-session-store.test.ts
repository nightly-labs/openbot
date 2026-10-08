// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteDirectSessionStore, type RemoteDirectSessionStoreOptions } from "./remote-direct-session-store";

const SERVER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_SERVER = "00000000-0000-4000-8000-0000000000bb";
const DIRECT_URL = "https://studio-mac.tail4b2c1.ts.net";
const TOKEN = "kept-direct-session-token-0123456789";
const session = { url: DIRECT_URL, token: TOKEN, expiresAt: 1_900_000_000_000 };

// A cipher that a test can tell from plain text: the content is reversed behind a marker.
const MARKER = "sealed:";
const cipher = {
  encrypt: (value: string) => Buffer.from(`${MARKER}${[...value].reverse().join("")}`),
  decrypt: (value: Buffer) => {
    const text = value.toString();
    if (!text.startsWith(MARKER)) throw new Error("Not sealed with this key.");
    return [...text.slice(MARKER.length)].reverse().join("");
  },
};

let directory = "";
let path = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-direct-sessions-"));
  path = join(directory, "openbot-direct-sessions-v1.bin");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function store(options: Partial<RemoteDirectSessionStoreOptions> = {}): RemoteDirectSessionStore {
  return new RemoteDirectSessionStore({ path, canPersist: () => true, ...cipher, ...options });
}

async function loaded(options: Partial<RemoteDirectSessionStoreOptions> = {}): Promise<RemoteDirectSessionStore> {
  const result = store(options);
  await Effect.runPromise(result.load());
  return result;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

describe("RemoteDirectSessionStore", () => {
  it("keeps a session for the next run, encrypted, and the token is not in the file as text", async () => {
    await Effect.runPromise(store().set("user-1", SERVER, session));
    const content = await readFile(path, "utf8");
    expect(content).not.toContain(TOKEN);
    expect(Buffer.from(content, "base64").toString()).not.toContain(TOKEN);
    expect(Buffer.from(content, "base64").toString().startsWith(MARKER)).toBe(true);
    // The file is readable only by the user.
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);

    const next = await loaded();
    expect(next.get("user-1", SERVER)).toEqual(session);
    expect(next.get("user-1", OTHER_SERVER)).toBeNull();
  });

  it("does not give a session of one account to another, and another account's session replaces it", async () => {
    await Effect.runPromise(store().set("user-1", SERVER, session));
    const next = await loaded();
    expect(next.get("user-2", SERVER)).toBeNull();
    await Effect.runPromise(next.set("user-2", OTHER_SERVER, { ...session, token: "second-account-token-0123" }));
    const third = await loaded();
    expect(third.get("user-1", SERVER)).toBeNull();
    expect(third.get("user-2", OTHER_SERVER)?.token).toBe("second-account-token-0123");
  });

  it("reads a damaged, foreign or unknown file as no session, and writes over it", async () => {
    for (const content of [
      "not base64 at all %%%",
      Buffer.from("plain text, not sealed").toString("base64"),
      cipher.encrypt("{not json").toString("base64"),
      cipher.encrypt(JSON.stringify({ version: 2, principalId: "user-1", sessions: {} })).toString("base64"),
    ]) {
      await writeFile(path, content);
      const next = await loaded();
      expect(next.get("user-1", SERVER)).toBeNull();
    }
    const next = await loaded();
    await Effect.runPromise(next.set("user-1", SERVER, session));
    expect((await loaded()).get("user-1", SERVER)).toEqual(session);
  });

  it("drops a record with an address outside ts.net, an empty token or no end", async () => {
    const sessions = {
      [SERVER]: { url: "https://example.com", token: TOKEN, expiresAt: 1 },
      [OTHER_SERVER]: { url: DIRECT_URL, token: "", expiresAt: 1 },
      third: { url: DIRECT_URL, token: TOKEN, expiresAt: "tomorrow" },
      fourth: { url: DIRECT_URL, token: TOKEN, expiresAt: 5 },
    };
    await writeFile(
      path,
      cipher.encrypt(JSON.stringify({ version: 1, principalId: "user-1", sessions })).toString("base64"),
    );
    const next = await loaded();
    expect(next.get("user-1", SERVER)).toBeNull();
    expect(next.get("user-1", OTHER_SERVER)).toBeNull();
    expect(next.get("user-1", "third")).toBeNull();
    expect(next.get("user-1", "fourth")).toEqual({ url: DIRECT_URL, token: TOKEN, expiresAt: 5 });
  });

  it("writes nothing without the operating-system storage, and removes a file of an earlier run", async () => {
    await Effect.runPromise(store().set("user-1", SERVER, session));
    expect(await exists(path)).toBe(true);
    const unavailable = await loaded({
      canPersist: () => false,
      encrypt: () => {
        throw new Error("unavailable");
      },
    });
    await Effect.runPromise(unavailable.set("user-1", OTHER_SERVER, session));
    expect(await exists(path)).toBe(false);

    const throwing = store({
      canPersist: () => {
        throw new Error("unavailable");
      },
    });
    await Effect.runPromise(throwing.set("user-1", SERVER, session));
    expect(await exists(path)).toBe(false);
  });

  it("removes one server, and the file with the last one; clear removes all", async () => {
    const kept = store();
    await Effect.runPromise(kept.set("user-1", SERVER, session));
    await Effect.runPromise(kept.set("user-1", OTHER_SERVER, session));
    await Effect.runPromise(kept.delete(SERVER));
    expect((await loaded()).get("user-1", SERVER)).toBeNull();
    expect((await loaded()).get("user-1", OTHER_SERVER)).toEqual(session);
    await Effect.runPromise(kept.delete(OTHER_SERVER));
    expect(await exists(path)).toBe(false);

    await Effect.runPromise(kept.set("user-1", SERVER, session));
    await Effect.runPromise(kept.clear());
    expect(await exists(path)).toBe(false);
    expect(kept.get("user-1", SERVER)).toBeNull();
  });

  it("redacts a kept token in logs, also one read from the file", async () => {
    const token = "token-read-back-from-disk-0123456789";
    await writeFile(
      path,
      cipher
        .encrypt(JSON.stringify({ version: 1, principalId: "user-1", sessions: { [SERVER]: { ...session, token } } }))
        .toString("base64"),
    );
    await loaded();
    expect(redactText(`Bearer ${token}`)).not.toContain(token);
    await Effect.runPromise(store().set("user-1", SERVER, session));
    expect(redactText(`token=${TOKEN}`)).not.toContain(TOKEN);
  });
});
