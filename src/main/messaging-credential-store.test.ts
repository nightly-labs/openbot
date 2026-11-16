// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessagingCredentialStore } from "./messaging-credential-store";

/** Reverses the bytes, so the file never holds the plain text and a test can still read it back. */
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-messaging-credentials-"));
  path = join(directory, "messaging-credentials.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("MessagingCredentialStore redaction", () => {
  // Each test uses its own values: the registered secrets stay for the life of the process.
  it("redacts the saved tokens and keeps the chat, bot and server names readable", async () => {
    const store = new MessagingCredentialStore(path, cipher);
    await Effect.runPromise(store.load());
    await Effect.runPromise(
      store.set("telegram-connection", {
        botId: "7012345678",
        chatId: "-1001234567890",
        chatTitle: "Financeiro",
        botUsername: "setor_helper_bot",
      }),
    );
    await Effect.runPromise(
      store.set("whatsapp-connection", { whatsappStoreKey: "c3RvcmUta2V5LXNldA==", storeId: "store-id-set-1" }),
    );

    expect(redactText("Setor: Financeiro, @setor_helper_bot")).toBe("Setor: Financeiro, @setor_helper_bot");
    expect(redactText("chat -1001234567890 bot 7012345678 key c3RvcmUta2V5LXNldA==")).toBe(
      "chat [redacted] bot [redacted] key [redacted]",
    );
  });

  it("applies the same rule to the values that it reads from the file", async () => {
    const values = { botToken: "slack-app-token-Zq81mW", guildName: "Engenharia", guildId: "998877665544" };
    const envelope = {
      version: 1,
      connections: { connection: cipher.encrypt(JSON.stringify(values)).toString("base64") },
    };
    await writeFile(path, JSON.stringify(envelope));
    const store = new MessagingCredentialStore(path, cipher);

    expect(await Effect.runPromise(store.load())).toBeNull();
    expect(redactText("Servidor Engenharia")).toBe("Servidor Engenharia");
    expect(redactText("slack-app-token-Zq81mW in 998877665544")).toBe("[redacted] in [redacted]");
  });
});
