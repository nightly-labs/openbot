import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderCredentialStore } from "./provider-credential-store";

/**
 * A reversible stand-in for `safeStorage`, so the test can prove the file holds ciphertext.
 *
 * It reverses the string, which keeps the plaintext out of the file while leaving the round trip
 * checkable. A real cipher would prove the same property, but it needs an Electron process.
 */
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => [...value.toString("utf8")].reverse().join(""),
};

async function createStore(): Promise<{ path: string; store: ProviderCredentialStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-provider-credentials-"));
  const path = join(root, "credentials.json");
  const store = new ProviderCredentialStore(path, cipher);
  await store.load();
  return { path, store };
}

describe("ProviderCredentialStore", () => {
  it("reads back a saved key in a new store", async () => {
    const { path, store } = await createStore();
    await store.set("opencode", "zen-key-value");

    const reopened = new ProviderCredentialStore(path, cipher);
    await reopened.load();
    expect(reopened.get("opencode")).toBe("zen-key-value");
    expect(reopened.has("opencode")).toBe(true);
    expect(reopened.get("codex")).toBeNull();
  });

  it("writes no plaintext to disk", async () => {
    const { path, store } = await createStore();
    await store.set("opencode", "zen-key-value");

    // The file is the one artifact a backup tool, a sync client, or a support bundle can pick up,
    // so the key must not be readable in it under any encoding the file uses.
    const source = await readFile(path, "utf8");
    expect(source).not.toContain("zen-key-value");
    expect(JSON.parse(source)).toMatchObject({ version: 1 });
  });

  it.runIf(process.platform !== "win32")("keeps the file readable only by its owner", async () => {
    const { path, store } = await createStore();
    await store.set("opencode", "zen-key-value");

    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("rejects an envelope it cannot understand", async () => {
    const { path } = await createStore();
    await writeFile(path, JSON.stringify({ version: 2, credentials: {} }), "utf8");
    await expect(new ProviderCredentialStore(path, cipher).load()).rejects.toThrow();

    await writeFile(path, JSON.stringify({ version: 1, credentials: { opencode: 7 } }), "utf8");
    await expect(new ProviderCredentialStore(path, cipher).load()).rejects.toThrow();
  });

  it("keeps the previous key when a write did not finish", async () => {
    const { path, store } = await createStore();
    await store.set("opencode", "first-key");
    // What a crash between the temporary write and the rename leaves behind. The saved key has to
    // survive it, so `load` must read the renamed envelope and never the half-written temporary
    // file: a partial write must not take a paid account away from the user.
    await writeFile(`${path}.tmp`, '{"version":1,"credenti', "utf8");

    const reopened = new ProviderCredentialStore(path, cipher);
    await reopened.load();
    expect(reopened.get("opencode")).toBe("first-key");
  });

  it("clears one provider and keeps the others", async () => {
    const { path, store } = await createStore();
    await store.set("opencode", "zen-key-value");
    await store.set("codex", "codex-key-value");

    await store.clear("opencode");
    expect(store.get("opencode")).toBeNull();
    expect(store.get("codex")).toBe("codex-key-value");

    const reopened = new ProviderCredentialStore(path, cipher);
    await reopened.load();
    expect(reopened.get("opencode")).toBeNull();
    expect(reopened.get("codex")).toBe("codex-key-value");
  });

  it("refuses to report a key before it is loaded", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-provider-credentials-"));
    const store = new ProviderCredentialStore(join(root, "credentials.json"), cipher);
    // Reporting "no key" here would start the free tier for a user who paid for the full catalog,
    // and the mistake would look like an OpenCode fault rather than a load OpenBot never ran.
    expect(() => store.get("opencode")).toThrow();
  });
});
