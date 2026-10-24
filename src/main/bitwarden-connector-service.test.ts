import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type BitwardenCliRunner, BitwardenConnectorService } from "./bitwarden-connector-service";
import { BitwardenConnectorStore, isBitwardenSessionRecord } from "./bitwarden-connector-store";

const SESSION_KEY = ["bw", "fixture", "session"].join("-");
const ITEM_ID = "12345678-1234-1234-1234-123456789abc";
const FOLDER_ID = "shared";
const fakeCipher = {
  encrypt: (value: string) => Buffer.from(Buffer.from(value, "utf8").toString("hex"), "utf8"),
  decrypt: (value: Buffer) => Buffer.from(value.toString("utf8"), "hex").toString("utf8"),
};

function fakeBitwardenCli(calls: { args: string[]; env: Record<string, string> }[]): BitwardenCliRunner {
  return async (_executable, args, env) => {
    calls.push({ args: [...args], env: { ...env } });
    if (env.BW_SESSION !== SESSION_KEY) throw new Error("locked");
    const [command, target] = args;
    if (command === "sync") return "Syncing complete.";
    if (command === "list" && target === "folders")
      return JSON.stringify([{ id: FOLDER_ID, name: "Shared with OpenBot" }]);
    if (command === "list" && target === "items")
      return JSON.stringify([
        {
          id: ITEM_ID,
          name: "Example",
          type: 1,
          folderId: FOLDER_ID,
          login: { username: "ada", uris: [{ uri: "https://example.com/login", match: null }] },
        },
      ]);
    throw new Error(`Unexpected bw call: ${command}`);
  };
}

describe("BitwardenConnectorService session persistence", () => {
  let directory = "";

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function setup() {
    directory = await mkdtemp(join(tmpdir(), "openbot-bitwarden-"));
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const file = join(directory, "openbot-bitwarden-connector-v1.json");
    const create = () =>
      new BitwardenConnectorService({
        runCli: fakeBitwardenCli(calls),
        findCli: async () => "/fixture/bw",
        host: {
          store: new BitwardenConnectorStore(file, fakeCipher),
          dataDirectory: join(directory, "host"),
          installCli: null,
        },
      });
    return { calls, file, create };
  }

  it("reconnects a pasted session key after a restart without writing it in plain text", async () => {
    const { calls, file, create } = await setup();
    const first = create();
    await Effect.runPromise(first.connect(SESSION_KEY));
    expect(first.status()).toMatchObject({ connected: true, connecting: false, serverUrl: null });
    const envelopeText = await readFile(file, "utf8");
    expect(envelopeText).not.toContain(SESSION_KEY);
    expect(JSON.parse(envelopeText)).toEqual(expect.objectContaining({ version: 2, record: expect.any(String) }));
    await Effect.runPromise(first.dispose());

    const second = create();
    await Effect.runPromise(second.load());
    expect(second.status().connected).toBe(true);
    const logins = await Effect.runPromise(second.loginsFor("https://example.com"));
    expect(logins).toEqual([{ id: ITEM_ID, title: "Example", username: "ada", hasOneTimePassword: false }]);
    expect(calls.some((call) => call.env.BW_SESSION === SESSION_KEY && !call.env.BITWARDENCLI_APPDATA_DIR)).toBe(true);
    await Effect.runPromise(second.disconnect());
    const third = create();
    await Effect.runPromise(third.load());
    expect(third.status().connected).toBe(false);
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a version-1 host record readable", async () => {
    const { file, create } = await setup();
    const store = new BitwardenConnectorStore(file, fakeCipher);
    await Effect.runPromise(
      store.write(
        {
          serverUrl: "https://vault.example.com",
          clientId: "user.fixture",
          clientSecret: "fixture-secret",
          masterPassword: "fixture-password",
          connectedAt: 1,
        },
        () => true,
      ),
    );
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(expect.objectContaining({ version: 1 }));
    const connector = create();
    await Effect.runPromise(connector.load());
    expect(connector.status()).toMatchObject({ connected: true, serverUrl: "https://vault.example.com" });
    const record = new BitwardenConnectorStore(file, fakeCipher);
    await Effect.runPromise(record.load());
    const loaded = record.read();
    expect(loaded && !isBitwardenSessionRecord(loaded)).toBe(true);
  });
});
