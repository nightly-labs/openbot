// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SaveCustomMcpInput } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CustomMcpCipher, CustomMcpStore } from "./custom-mcp-store";

let root = "";
let path = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-custom-mcp-"));
  path = join(root, "nested", "openbot-custom-mcp-v1.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function testCipher(overrides: Partial<CustomMcpCipher> = {}): CustomMcpCipher {
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

function stdio(overrides: Partial<Extract<SaveCustomMcpInput, { transport: "stdio" }>> = {}): SaveCustomMcpInput {
  return {
    id: "notes",
    name: "Notes",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@example/notes"],
    env: [{ name: "NOTES_TOKEN", value: "secret" }],
    ...overrides,
  };
}

function http(overrides: Partial<Extract<SaveCustomMcpInput, { transport: "http" }>> = {}): SaveCustomMcpInput {
  return {
    id: "linear",
    name: "Linear",
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    headers: [{ name: "Authorization", value: "Bearer token" }],
    ...overrides,
  };
}

async function loaded(cipher: CustomMcpCipher = testCipher()): Promise<CustomMcpStore> {
  const store = new CustomMcpStore({ path, cipher });
  await store.load();
  return store;
}

describe("CustomMcpStore", () => {
  it("gives a fresh instance the server back without its credentials on the list", async () => {
    const store = await loaded();
    await store.save(stdio());
    await store.save(http());

    const reopened = await loaded();
    expect(reopened.list()).toEqual([
      { id: "notes", name: "Notes", transport: "stdio", command: "npx", hasSecrets: true },
      { id: "linear", name: "Linear", transport: "http", url: "https://mcp.linear.app/mcp", hasSecrets: true },
    ]);
    expect(reopened.configs()).toEqual([
      {
        id: "notes",
        name: "Notes",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@example/notes"],
        env: [{ name: "NOTES_TOKEN", value: "secret" }],
      },
      {
        id: "linear",
        name: "Linear",
        transport: "http",
        url: "https://mcp.linear.app/mcp",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
    ]);
  });

  it("refuses a second save under the same id", async () => {
    const store = await loaded();
    await store.save(stdio());
    await expect(store.save(stdio())).rejects.toThrow("already saved");
  });

  it("persists full MCP access beside the server list", async () => {
    const store = await loaded();
    expect(store.fullAccess()).toBe(false);
    await store.setFullAccess(true);
    expect(store.fullAccess()).toBe(true);
    const reopened = await loaded();
    expect(reopened.fullAccess()).toBe(true);
  });

  it("refuses env on a computer with no secure storage, and still saves a keyless command", async () => {
    const store = await loaded(testCipher({ canPersist: () => false }));
    await expect(store.save(stdio())).rejects.toThrow("no secure storage");
    await store.save(stdio({ env: [] }));
    expect(store.list()[0]?.hasSecrets).toBe(false);
  });
});
