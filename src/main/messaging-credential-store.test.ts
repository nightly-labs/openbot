import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { MessagingCredentialStore } from "./messaging-credential-store";

/** A reversible stand-in for `safeStorage`, as in the provider key tests. */
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => [...value.toString("utf8")].reverse().join(""),
};

const TOKENS = { botToken: "xoxb-1-2-storedbottokenvalue", appToken: "xapp-1-A-storedapptokenvalue" };

async function createStore(): Promise<{ path: string; store: MessagingCredentialStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-messaging-credentials-"));
  const path = join(root, "messaging.json");
  const store = new MessagingCredentialStore(path, cipher);
  await Effect.runPromise(store.load());
  return { path, store };
}

describe("MessagingCredentialStore", () => {
  it("keeps the tokens encrypted, private to the owner, and out of every log line", async () => {
    const { path, store } = await createStore();
    await Effect.runPromise(store.set("connection-1", TOKENS).pipe(Effect.mapError((error) => error.cause)));

    const source = await readFile(path, "utf8");
    expect(source).not.toContain("storedbottokenvalue");
    expect(source).not.toContain("storedapptokenvalue");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(redactText(`failed with ${TOKENS.botToken} and ${TOKENS.appToken}`)).not.toContain("storedbot");

    const reopened = new MessagingCredentialStore(path, cipher);
    await Effect.runPromise(reopened.load());
    expect(reopened.get("connection-1")).toEqual(TOKENS);
    expect(reopened.status("connection-2")).toBe("missing");
  });

  it("reports an unreadable file without failing, and a save replaces it", async () => {
    const { path } = await createStore();
    await writeFile(path, "{ not json");
    const store = new MessagingCredentialStore(path, cipher);
    expect(await Effect.runPromise(store.load())).toBeInstanceOf(Error);
    expect(store.status("connection-1")).toBe("unreadable");

    await Effect.runPromise(store.set("connection-1", TOKENS).pipe(Effect.mapError((error) => error.cause)));
    expect(store.status("connection-1")).toBe("saved");
  });

  it("drops the tokens of connections that no longer exist", async () => {
    const { store } = await createStore();
    await Effect.runPromise(store.set("kept", TOKENS).pipe(Effect.mapError((error) => error.cause)));
    await Effect.runPromise(store.set("gone", TOKENS).pipe(Effect.mapError((error) => error.cause)));
    await Effect.runPromise(store.retain(new Set(["kept"])).pipe(Effect.mapError((error) => error.cause)));
    expect(store.status("gone")).toBe("missing");
    expect(store.status("kept")).toBe("saved");
  });
});
