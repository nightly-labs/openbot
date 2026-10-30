// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultService } from "./vault-service";
import { VaultStore } from "./vault-store";

/** Reverses the bytes, so the file never holds the plain text and a test can still read it back. */
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-vault-"));
  path = join(directory, "openbot-vault-v1.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function service() {
  return new VaultService({ store: new VaultStore(path, cipher), canPersist: () => true });
}

const LOGIN = {
  kind: "login" as const,
  id: null,
  website: "https://example.com",
  username: "ada",
  notes: "",
  password: "vault-login-secret-1",
};

const CARD = {
  kind: "card" as const,
  id: null,
  label: "Work",
  nameOnCard: "Ada Lovelace",
  expMonth: 12,
  expYear: 2034,
  billingContactId: null,
  number: "4000056655665556",
  securityCode: "123",
};

const API_KEY = {
  kind: "apiKey" as const,
  id: null,
  name: "OPENAI_API_KEY",
  notes: "",
  key: "vault-api-key-secret-1",
};

describe("Vault secret redaction", () => {
  it("redacts a saved password and card number, in each form a page or log can show", async () => {
    const vault = service();
    await Effect.runPromise(vault.load());
    await Effect.runPromise(vault.save(LOGIN));
    await Effect.runPromise(vault.save(CARD));
    const line = `typed vault-login-secret-1 and 4000056655665556, 4000 0566 5566 5556, 4000-0566-5566-5556`;
    const redacted = redactText(line);
    expect(redacted).not.toContain("vault-login-secret-1");
    expect(redacted).not.toContain("4000056655665556");
    expect(redacted).not.toContain("4000 0566 5566 5556");
    expect(redacted).not.toContain("4000-0566-5566-5556");
  });

  it("redacts a saved API key and keeps it out of the summary", async () => {
    const vault = service();
    await Effect.runPromise(vault.load());
    const state = await Effect.runPromise(vault.save(API_KEY));
    expect(JSON.stringify(state)).not.toContain("vault-api-key-secret-1");
    expect(redactText("OPENAI_API_KEY=vault-api-key-secret-1")).not.toContain("vault-api-key-secret-1");
    const reader = service();
    await Effect.runPromise(reader.load());
    const id = reader.state().items.find((item) => item.kind === "apiKey")?.id ?? "";
    expect(reader.reveal({ id, field: "key" })).toBe("vault-api-key-secret-1");
  });

  it("redacts the secrets of a file that a new process loads", async () => {
    // Written without the service, so only the load can register these values. It has no `apiKeys`,
    // as a build before API keys wrote it.
    const record = {
      logins: [{ id: "l1", website: "example.com", username: "ada", password: "vault-login-secret-2", notes: "" }],
      cards: [{ ...CARD, id: "c1", number: "5555555555554444", billingContactId: null }],
      contacts: [],
    };
    await writeFile(
      path,
      JSON.stringify({ version: 1, record: cipher.encrypt(JSON.stringify(record)).toString("base64") }),
    );
    expect(redactText("vault-login-secret-2 5555 5555 5555 4444")).toContain("vault-login-secret-2");
    const reader = service();
    await Effect.runPromise(reader.load());
    expect(reader.state().status).toBe("ready");
    const redacted = redactText("vault-login-secret-2 5555 5555 5555 4444");
    expect(redacted).not.toContain("vault-login-secret-2");
    expect(redacted).not.toContain("5555 5555 5555 4444");
    // The first API key keeps every item of the older file.
    await Effect.runPromise(reader.save(API_KEY));
    const upgraded = service();
    await Effect.runPromise(upgraded.load());
    expect(upgraded.state().items.map((item) => item.kind)).toEqual(["login", "card", "apiKey"]);
    expect(upgraded.reveal({ id: "l1", field: "password" })).toBe("vault-login-secret-2");
  });

  it("keeps the summary free of secrets and leaves an unreadable file in place", async () => {
    const vault = service();
    await Effect.runPromise(vault.load());
    const state = await Effect.runPromise(vault.save(CARD));
    expect(JSON.stringify(state)).not.toContain("4000056655665556");
    expect(JSON.stringify(state)).not.toContain('"123"');
    await writeFile(path, "not json");
    const broken = service();
    await Effect.runPromise(broken.load());
    expect(broken.state().status).toBe("unreadable");
    await expect(Effect.runPromise(broken.save(LOGIN))).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("not json");
  });
});
