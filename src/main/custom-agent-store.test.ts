import { Effect } from "effect";
// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SaveCustomAgentInput } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { CustomAgentStore } from "./custom-agent-store";
import type { CustomProviderCipher } from "./custom-provider-store";

let root = "";
let path = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-custom-agents-"));
  path = join(root, "nested", "custom-agents.json");
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

function input(overrides: Partial<SaveCustomAgentInput> = {}): SaveCustomAgentInput {
  return {
    id: "goose",
    name: "Goose",
    command: "/opt/homebrew/bin/goose",
    args: ["acp"],
    env: [
      { name: "GOOSE_PROVIDER", value: "ollama" },
      { name: "OPENAI_API_KEY", value: "sk-agent-secret" },
    ],
    ...overrides,
  };
}

async function loaded(cipher: CustomProviderCipher = testCipher()): Promise<CustomAgentStore> {
  const store = new CustomAgentStore({ path, cipher, resolve: (command) => Effect.succeed(command) });
  await Effect.runPromise(store.load());
  return store;
}

describe("CustomAgentStore", () => {
  it("gives a fresh instance the agent back, and never lists or writes a value in plaintext", async () => {
    const store = await loaded();
    await runCauseEffect(store.save(input()));

    const reopened = await loaded();
    expect(await Effect.runPromise(reopened.list())).toEqual([
      {
        id: "goose",
        name: "Goose",
        command: "/opt/homebrew/bin/goose",
        args: ["acp"],
        envNames: ["GOOSE_PROVIDER", "OPENAI_API_KEY"],
        resolvedCommand: "/opt/homebrew/bin/goose",
      },
    ]);
    expect(JSON.stringify(await Effect.runPromise(reopened.list()))).not.toContain("sk-agent-secret");
    expect(await readFile(path, "utf8")).not.toContain("sk-agent-secret");
    expect(reopened.configs()[0]?.env).toEqual([
      { name: "GOOSE_PROVIDER", value: "ollama" },
      { name: "OPENAI_API_KEY", value: "sk-agent-secret" },
    ]);
  });

  it("keeps the ciphertext byte for byte when an edit keeps every value", async () => {
    const store = await loaded();
    await runCauseEffect(store.save(input()));
    const before = JSON.parse(await readFile(path, "utf8")).agents[0].secret;

    // A computer whose keychain is gone must not lose values a later keychain could still open.
    const locked = await loaded(
      testCipher({
        decrypt: () => {
          throw new Error("locked");
        },
      }),
    );
    await runCauseEffect(
      locked.save(
        input({
          name: "Goose 2",
          env: [
            { name: "GOOSE_PROVIDER", value: null },
            { name: "OPENAI_API_KEY", value: null },
          ],
        }),
      ),
    );

    const after = JSON.parse(await readFile(path, "utf8")).agents[0];
    expect(after.name).toBe("Goose 2");
    expect(after.secret).toBe(before);
  });

  it("takes a kept value and a new value together", async () => {
    const store = await loaded();
    await runCauseEffect(store.save(input()));
    await runCauseEffect(
      store.save(
        input({
          env: [
            { name: "GOOSE_PROVIDER", value: "openai" },
            { name: "OPENAI_API_KEY", value: null },
          ],
        }),
      ),
    );

    expect((await loaded()).configs()[0]?.env).toEqual([
      { name: "GOOSE_PROVIDER", value: "openai" },
      { name: "OPENAI_API_KEY", value: "sk-agent-secret" },
    ]);
  });

  it("refuses a kept value that main does not hold, and writes nothing", async () => {
    const store = await loaded();
    await expect(runCauseEffect(store.save(input({ env: [{ name: "OPENAI_API_KEY", value: null }] })))).rejects.toThrow(
      "OPENAI_API_KEY",
    );
    expect(await Effect.runPromise(store.list())).toEqual([]);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a value when the keychain cannot store it", async () => {
    const store = await loaded(testCipher({ canPersist: () => false }));
    await expect(runCauseEffect(store.save(input()))).rejects.toThrow();
    await runCauseEffect(store.save(input({ env: [] })));
    expect((await Effect.runPromise(store.list()))[0]?.envNames).toEqual([]);
  });

  it("gives a check the saved value of the agent it names", async () => {
    const store = await loaded();
    await runCauseEffect(store.save(input()));
    expect(store.checkEnv([{ name: "OPENAI_API_KEY", value: null }], "goose")).toEqual({
      OPENAI_API_KEY: "sk-agent-secret",
    });
    expect(() => store.checkEnv([{ name: "OPENAI_API_KEY", value: null }], undefined)).toThrow();
  });

  it("does not overwrite a file this build cannot read", async () => {
    const newer = JSON.stringify({ version: 2, agents: [{ id: "future" }] });
    await rm(join(root, "nested"), { recursive: true, force: true });
    await writeFile(join(root, "custom-agents.json"), newer);
    path = join(root, "custom-agents.json");

    const store = await loaded();
    expect(await Effect.runPromise(store.list())).toEqual([]);
    await expect(runCauseEffect(store.save(input()))).rejects.toThrow();
    await expect(runCauseEffect(store.remove("future"))).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(newer);
  });

  it("keeps an agent whose values this computer cannot open, without its values", async () => {
    const store = await loaded();
    await runCauseEffect(store.save(input()));

    const other = await loaded(
      testCipher({
        decrypt: () => {
          throw new Error("another keychain");
        },
      }),
    );
    expect((await Effect.runPromise(other.list()))[0]?.envNames).toEqual(["GOOSE_PROVIDER", "OPENAI_API_KEY"]);
    expect(other.configs()[0]?.env).toEqual([]);
  });
});
