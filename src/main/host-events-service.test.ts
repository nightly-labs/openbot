import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "../backend/event-store";
import { OpenBotDatabase } from "../backend/openbot-database";
import { HostEventsService } from "./host-events-service";
import { createWebhookSignature } from "./webhook-security";

// Failure modes: unsigned input starts work; a lost acknowledgement repeats accepted work;
// secrets cross a management response or reach disk as plaintext; disabling fails open offline.
const signingSecret = "host-events-test-signing-secret-32-characters";
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join("")),
  decrypt: (value: Buffer) => [...value.toString()].reverse().join(""),
};
const databases: OpenBotDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbot-events-"));
  const database = new OpenBotDatabase(root);
  await Effect.runPromise(database.initialize());
  databases.push(database);
  const wake = vi.fn();
  const relay = {
    connected: () => true,
    registerSource: (sourceId: string) => Effect.succeed(`https://signal.example/v1/webhooks/${sourceId}`),
    revokeSource: (_sourceId: string): Effect.Effect<void, { readonly cause: unknown }> => Effect.void,
  };
  const service = new HostEventsService({
    database,
    cipher,
    relay,
    wake,
    routines: {
      list: () => [],
      save: () => Effect.die(new Error("Not part of this receipt check.")),
      delete: () => Effect.void,
      test: () => Effect.void,
      dispatch: () => Effect.void,
    },
  });
  const source = await Effect.runPromise(
    service.saveSource({ name: "Build events", active: true, secret: signingSecret }),
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ type: "build.completed", data: { branch: "main" } }));
  const deliveryId = "build-123";
  const receipt = {
    sourceId: source.id,
    timestamp,
    deliveryId,
    body,
    signature: createWebhookSignature(signingSecret, timestamp, deliveryId, body),
  };
  return { root, database, store: new EventStore(database), service, source, receipt, relay, wake };
}

describe("HostEventsService receipt boundary", () => {
  it("commits one receipt when the sender retries after a lost acknowledgement", async () => {
    const { database, service, receipt, source } = await fixture();
    expect(await Effect.runPromise(service.receive(receipt))).toEqual({ status: 202 });
    expect(await Effect.runPromise(service.receive(receipt))).toEqual({ status: 202 });
    const rows = database.connection
      .prepare("SELECT event_id FROM projection_event_receipts WHERE source_id = ?")
      .all(source.id);
    expect(rows).toHaveLength(1);
    const activity = await Effect.runPromise(service.listActivity());
    expect(activity.map((entry) => entry.status)).toEqual(expect.arrayContaining(["accepted", "duplicate"]));
    await mkdir(".openbot-build", { recursive: true });
    await writeFile(
      ".openbot-build/webhook-receipt-report.json",
      `${JSON.stringify(
        {
          scenario: "signed receipt and lost acknowledgement",
          acceptedReceipts: rows.length,
          statuses: activity.map((entry) => entry.status),
          passed: true,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("rejects changed bytes and stale timestamps before storage", async () => {
    const { database, service, receipt } = await fixture();
    expect(await Effect.runPromise(service.receive({ ...receipt, body: Buffer.from("{}") }))).toEqual({ status: 401 });
    const timestamp = String(Math.floor(Date.now() / 1000) - 601);
    const stale = {
      ...receipt,
      timestamp,
      signature: createWebhookSignature(signingSecret, timestamp, receipt.deliveryId, receipt.body),
    };
    expect(await Effect.runPromise(service.receive(stale))).toEqual({ status: 401 });
    expect(database.connection.prepare("SELECT event_id FROM projection_event_receipts").all()).toEqual([]);
  });

  it("keeps secrets out of the database plaintext and management reads", async () => {
    const { database, service } = await fixture();
    const rows = database.connection.prepare("SELECT * FROM projection_event_sources").all();
    expect(JSON.stringify(rows)).not.toContain(signingSecret);
    const sources = await Effect.runPromise(service.listSources());
    expect(JSON.stringify(sources)).not.toContain(signingSecret);
    expect(sources[0]).not.toHaveProperty("secretCiphertext");
    expect(sources[0]).not.toHaveProperty("secret");
  });

  it("refuses receipts after disable even if remote revocation fails", async () => {
    const { service, relay, receipt, source } = await fixture();
    relay.revokeSource = () => Effect.fail({ cause: new Error("offline") });
    await expect(
      Effect.runPromise(service.saveSource({ id: source.id, name: source.name, active: false })),
    ).rejects.toThrow();
    expect(await Effect.runPromise(service.receive(receipt))).toEqual({ status: 404 });
  });

  it("accepts only the replacement secret after rotation", async () => {
    const { service, receipt, source } = await fixture();
    const replacement = "replacement-webhook-signing-secret-32-characters";
    await Effect.runPromise(
      service.saveSource({ id: source.id, name: source.name, active: true, secret: replacement }),
    );
    expect(await Effect.runPromise(service.receive(receipt))).toEqual({ status: 401 });
    expect(
      await Effect.runPromise(
        service.receive({
          ...receipt,
          signature: createWebhookSignature(replacement, receipt.timestamp, receipt.deliveryId, receipt.body),
        }),
      ),
    ).toEqual({ status: 202 });
  });
});
