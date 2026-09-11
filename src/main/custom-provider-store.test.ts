// @vitest-environment node

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CustomProviderCipher, CustomProviderStore } from "./custom-provider-store";

let root = "";
let path = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-custom-providers-"));
  path = join(root, "nested", "openbot-custom-providers-v1.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A stand-in `safeStorage`: reversible, and obviously not the plaintext. */
function testCipher(overrides: Partial<CustomProviderCipher> = {}): CustomProviderCipher {
  return {
    canPersist: () => true,
    encrypt: (value) => Buffer.from(`sealed:${value}`, "utf8"),
    decrypt: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("This ciphertext was written by another keychain.");
      return text.slice("sealed:".length);
    },
    ...overrides,
  };
}

function input(overrides: Partial<SaveCustomProviderInput> = {}): SaveCustomProviderInput {
  return {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "sk-secret-key",
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    headers: [{ name: "X-Tenant", value: "tenant-secret" }],
    ...overrides,
  };
}

async function loaded(cipher: CustomProviderCipher = testCipher()): Promise<CustomProviderStore> {
  const store = new CustomProviderStore({ path, cipher });
  await store.load();
  return store;
}

describe("CustomProviderStore", () => {
  it("gives a fresh instance the endpoint and its credentials back", async () => {
    const store = await loaded();
    await store.save(input());

    const reopened = await loaded();
    expect(reopened.list()).toEqual([
      { id: "studio-local", name: "Studio Local", baseUrl: "http://127.0.0.1:11434/v1", hasApiKey: true },
    ]);
    expect(reopened.configs()).toEqual([
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "sk-secret-key",
        models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
        headers: [{ name: "X-Tenant", value: "tenant-secret" }],
      },
    ]);
  });

  it("writes neither the key nor a header value in plain text", async () => {
    const store = await loaded();
    await store.save(input());

    // Read as bytes: a key hidden from a string search by an escape or an encoding would still be
    // the key on disk.
    const raw = await readFile(path);
    expect(raw.includes("sk-secret-key")).toBe(false);
    expect(raw.includes("tenant-secret")).toBe(false);
    expect(raw.includes("X-Tenant")).toBe(false);
    // The list itself is plain, so a lost keychain does not lose it.
    expect(raw.includes("studio-local")).toBe(true);
  });

  it("tells the renderer nothing but the four fields it needs", async () => {
    const store = await loaded();
    await store.save(input());
    // Not `toEqual` on the whole object: this asserts that no fifth field can appear, whatever it
    // is named. `apiKey` and `headers` are the two that must never be here.
    expect(Object.keys(store.list()[0] ?? {}).sort()).toEqual(["baseUrl", "hasApiKey", "id", "name"]);
  });

  it("refuses a credential when the computer has no secure storage", async () => {
    const store = await loaded(testCipher({ canPersist: () => false }));
    await expect(store.save(input())).rejects.toThrow(/no secure storage/);
    expect(store.list()).toEqual([]);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("still saves a keyless endpoint without secure storage", async () => {
    const store = await loaded(testCipher({ canPersist: () => false }));
    await store.save(input({ apiKey: null, headers: [] }));
    expect(store.list()).toEqual([
      { id: "studio-local", name: "Studio Local", baseUrl: "http://127.0.0.1:11434/v1", hasApiKey: false },
    ]);
  });

  it("keeps an endpoint whose ciphertext this computer can no longer read", async () => {
    const store = await loaded();
    await store.save(input());

    const foreign = await loaded(
      testCipher({
        decrypt: () => {
          throw new Error("This ciphertext belongs to another keychain.");
        },
      }),
    );
    expect(foreign.list()).toEqual([
      { id: "studio-local", name: "Studio Local", baseUrl: "http://127.0.0.1:11434/v1", hasApiKey: false },
    ]);
    // The endpoint is still offered, without the credentials it can no longer supply, so the user
    // can see which one it is and add it again.
    expect(foreign.configs()).toEqual([expect.objectContaining({ id: "studio-local", apiKey: null, headers: [] })]);
  });

  it("refuses every write while the file belongs to a newer version", async () => {
    // A newer build's endpoints must survive a downgrade. Overwriting the file would lose them, and
    // an empty list plus the next save is exactly how that happens.
    const newer = `${JSON.stringify({ version: 2, providers: [{ id: "from-the-future" }] })}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, newer);

    const store = await loaded();
    expect(store.list()).toEqual([]);
    await expect(store.save(input())).rejects.toThrow(/newer version/);
    await expect(store.remove("from-the-future")).rejects.toThrow(/newer version/);
    expect(await readFile(path, "utf8")).toBe(newer);
  });

  it("refuses every write while the file cannot be parsed", async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ half a file");

    const store = await loaded();
    await expect(store.save(input())).rejects.toThrow(/cannot be read/);
    expect(await readFile(path, "utf8")).toBe("{ half a file");
  });

  it("refuses a second endpoint under one provider ID", async () => {
    const store = await loaded();
    await store.save(input());
    await expect(store.save(input({ name: "Another", apiKey: "sk-replacement" }))).rejects.toThrow(/already saved/);
    expect(store.list()).toHaveLength(1);
    expect(store.configs()[0]?.apiKey).toBe("sk-secret-key");
  });

  it("removes an endpoint and its credentials, and ignores an id it does not hold", async () => {
    const store = await loaded();
    await store.save(input());
    await store.save(input({ id: "house-router", name: "House Router" }));

    expect(await store.remove("studio-local")).toEqual([expect.objectContaining({ id: "house-router" })]);
    const raw = await readFile(path);
    expect(raw.includes("studio-local")).toBe(false);

    expect(await store.remove("studio-local")).toHaveLength(1);
  });

  it("keeps the endpoint listed when the removal cannot be written, and removes it on a retry", async () => {
    const store = await loaded();
    await store.save(input());
    // A directory this process cannot write to is the durable failure the user meets as a full or
    // read-only disk: the file keeps the endpoint, so the list in memory must keep it too.
    await chmod(dirname(path), 0o500);

    await expect(store.remove("studio-local")).rejects.toThrow();

    expect(store.list()).toHaveLength(1);
    await chmod(dirname(path), 0o700);
    expect(await store.remove("studio-local")).toEqual([]);
    expect((await readFile(path, "utf8")).includes("studio-local")).toBe(false);
  });

  it("leaves no temporary file behind", async () => {
    const store = await loaded();
    await store.save(input());
    await store.save(input({ id: "house-router" }));
    await store.remove("house-router");
    expect((await readdir(join(root, "nested"))).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
