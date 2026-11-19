// Checks a messaging token file that this computer cannot decrypt, such as after a change of the
// system keyring (#9167). A disconnect removes only the entry of its connection, keeps the other
// entries as they are, and the next start reads the kept entries when the keyring is back. A file
// that is not an envelope stays as it is. Runs the real credential store on a temporary profile, and
// loads it again to check that the result stays: `bun scripts/messaging-unreadable-credentials-e2e.ts`.
// Writes .openbot-build/messaging-unreadable-credentials-e2e/report.json.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { MessagingCredentialStore } from "../src/main/messaging-credential-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-unreadable-credentials-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-unreadable-"));
const path = join(root, "openbot-messaging-credentials-v1.json");

/** The keyring that saved the file: it reverses the bytes, so the file never holds the plain text. */
const savedKeyring = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};
/** The keyring after a change: it reads what it saved itself, not what the earlier one saved. */
const CHANGED = Buffer.from("new:");
const changedKeyring = {
  encrypt: (value: string) => Buffer.concat([CHANGED, savedKeyring.encrypt(value)]),
  decrypt: (value: Buffer): string => {
    if (!value.subarray(0, CHANGED.length).equals(CHANGED)) throw new Error("The keyring cannot decrypt this value.");
    return savedKeyring.decrypt(value.subarray(CHANGED.length));
  },
};

interface Step {
  name: string;
  passed: boolean;
}
const report: { steps: Step[]; passed: boolean } = { steps: [], passed: false };
const step = async (name: string, check: () => Promise<void>) => {
  await check();
  report.steps.push({ name, passed: true });
};
const envelopeSchema = z.object({ connections: z.record(z.string(), z.string()) });
const entries = () => envelopeSchema.parse(JSON.parse(readFileSync(path, "utf8"))).connections;

try {
  // Two connections, saved with the keyring that the computer had before.
  const before = new MessagingCredentialStore(path, savedKeyring);
  await Effect.runPromise(before.load());
  await Effect.runPromise(before.set("whatsapp-number", { storeId: "link-1", whatsappStoreKey: "a2V5LTE=" }));
  await Effect.runPromise(before.set("slack-workspace", { botToken: "xoxb-e2e-kept-token" }));
  const saved = entries();

  const store = new MessagingCredentialStore(path, changedKeyring);
  await step("a changed keyring reports the file and marks only its entries unreadable", async () => {
    assert.notEqual(await Effect.runPromise(store.load()), null);
    assert.equal(store.status("whatsapp-number"), "unreadable");
    assert.equal(store.status("slack-workspace"), "unreadable");
    assert.equal(store.status("disconnected-earlier"), "missing");
  });

  await step("a disconnect removes only its entry and keeps the other one as it is", async () => {
    await Effect.runPromise(store.clear("whatsapp-number"));
    assert.deepEqual(entries(), { "slack-workspace": saved["slack-workspace"] });
    assert.equal(store.status("whatsapp-number"), "missing");
    assert.equal(store.status("slack-workspace"), "unreadable");
  });

  await step("a disconnect of a connection that the file does not hold writes nothing", async () => {
    await Effect.runPromise(store.clear("disconnected-earlier"));
    assert.deepEqual(entries(), { "slack-workspace": saved["slack-workspace"] });
  });

  await step("the next start with the earlier keyring reads the kept entry", async () => {
    const restarted = new MessagingCredentialStore(path, savedKeyring);
    assert.equal(await Effect.runPromise(restarted.load()), null);
    assert.equal(restarted.status("whatsapp-number"), "missing");
    assert.deepEqual(restarted.get("slack-workspace"), { botToken: "xoxb-e2e-kept-token" });
  });

  await step("the last disconnect removes the file, and a new link saves again", async () => {
    await Effect.runPromise(store.clear("slack-workspace"));
    assert.equal(existsSync(path), false);
    assert.equal(store.status("slack-workspace"), "missing");
    await Effect.runPromise(store.set("whatsapp-number", { storeId: "link-2", whatsappStoreKey: "a2V5LTI=" }));
    const restarted = new MessagingCredentialStore(path, changedKeyring);
    assert.equal(await Effect.runPromise(restarted.load()), null);
    assert.equal(restarted.get("whatsapp-number")?.storeId, "link-2");
  });

  await step("a file that is not an envelope stays as it is", async () => {
    writeFileSync(path, "not an envelope");
    const damaged = new MessagingCredentialStore(path, savedKeyring);
    assert.notEqual(await Effect.runPromise(damaged.load()), null);
    assert.equal(damaged.status("any-connection"), "unreadable");
    await Effect.runPromise(damaged.clear("any-connection"));
    assert.equal(readFileSync(path, "utf8"), "not an envelope");
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Unreadable messaging credentials check passed. Report: ${join(OUT, "report.json")}\n`);
