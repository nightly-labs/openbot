// @vitest-environment node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventRoutineOwner, SaveEventRoutineInput } from "@openbot/contracts/ipc-events";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentService } from "../backend/agent-service";
import {
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../backend/agent-service-test-harness";
import { WebhookRouteConflict } from "./host-events-api";
import { HostEventsService } from "./host-events-service";
import { createWebhookSignature } from "./webhook-security";

// Failure modes, each with the test that covers it:
// - Unsigned, changed, or stale input starts a run: "rejects changed bytes and stale timestamps".
// - A sender retry after a lost acknowledgement starts a second run: "starts one run per delivery ID".
// - The signing secret reaches disk as plaintext or a management read: "shows the secret once".
// - The old secret still works after regeneration: "shows the secret once".
// - A deleted or switched routine keeps a live public route, also when Signal is offline:
//   "revokes the route of a deleted routine".
// - A route ID that the relay refuses for good keeps the URL empty forever: "replaces a refused route ID".
// - A member deletes or starts a webhook routine through the released routine routes, which have no
//   administrator check: "keeps webhook routines out of the released routine routes".
// - A secret that the host cannot decrypt answers 401, so the sender stops a retry that can succeed:
//   "rejects changed bytes and stale timestamps".
let decryptFails = false;
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join("")),
  decrypt: (value: Buffer) => {
    if (decryptFails) throw new Error("The keychain is locked.");
    return [...value.toString()].reverse().join("");
  },
};
let root: string | null = null;
let agentService: AgentService | null = null;

afterEach(async () => {
  decryptFails = false;
  if (root) await stopAgentTestFixture(root, agentService);
  root = null;
  agentService = null;
});

function fakeRelay() {
  const registered: string[] = [];
  const revoked: string[] = [];
  const relay = {
    registered,
    revoked,
    offline: false,
    conflicts: new Set<string>(),
    connected: () => true,
    setEnabled: (_enabled: boolean) => undefined,
    refresh: () => undefined,
    registerRoute: (routeId: string): Effect.Effect<string, { readonly cause: unknown } | WebhookRouteConflict> => {
      if (relay.offline) return Effect.fail({ cause: new Error("offline") });
      if (relay.conflicts.has(routeId)) return Effect.fail(new WebhookRouteConflict());
      relay.registered.push(routeId);
      return Effect.succeed(`https://signal.example/v1/webhooks/${routeId}`);
    },
    revokeRoute: (routeId: string): Effect.Effect<void, { readonly cause: unknown }> => {
      if (relay.offline) return Effect.fail({ cause: new Error("offline") });
      relay.revoked.push(routeId);
      return Effect.void;
    },
  };
  return relay;
}

async function fixture() {
  const started = await startAgentTestFixture();
  root = started.root;
  const { store, mailbox } = stores(root);
  await Effect.runPromise(store.initialize());
  await Effect.runPromise(mailbox.initialize());
  const agent = await Effect.runPromise(store.getOrCreate("webhook-agent"));
  const service = createTestService({
    store,
    mailbox,
    preferredProvider: "codex",
    clientFactory: (provider) => new FakeAgentClient(provider, "", false),
  });
  agentService = service;
  await Effect.runPromise(service.initialize());
  const relay = fakeRelay();
  const events = new HostEventsService({ routines: service.routineRecords, cipher, relay });
  const owner: EventRoutineOwner = { kind: "agent", id: agent.id };
  const input: SaveEventRoutineInput = {
    owner,
    name: "Build review",
    instruction: "PRIVATE SAVED INSTRUCTION",
    active: true,
    timezone: "UTC",
    trigger: { kind: "webhook", eventType: "build.completed", filters: [{ pointer: "/branch", value: "main" }] },
  };
  const saved = await Effect.runPromise(events.saveRoutine(input));
  if (saved.secret === null || saved.routine.trigger.kind !== "webhook") throw new Error("No webhook was made.");
  const routeId = relay.registered[0];
  if (!routeId) throw new Error("No route was registered.");
  const runs = () => service.listRoutineRuns({ agentId: agent.id, routineId: saved.routine.id, limit: 10 });
  return {
    database: store.database,
    service,
    events,
    relay,
    owner,
    input,
    saved,
    secret: saved.secret,
    routeId,
    runs,
  };
}

function signed(routeId: string, secret: string, deliveryId: string, payload: unknown) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify(payload));
  return {
    routeId,
    deliveryId,
    timestamp,
    body,
    signature: createWebhookSignature(secret, timestamp, deliveryId, body),
  };
}

const BUILD = { type: "build.completed", data: { branch: "main", text: "UNTRUSTED EVENT CONTENT" } };

describe("HostEventsService receipt boundary", () => {
  it("rejects changed bytes and stale timestamps before storage", async () => {
    const { database, events, routeId, secret, runs } = await fixture();
    const receipt = signed(routeId, secret, "build-1", BUILD);
    expect(await Effect.runPromise(events.receive({ ...receipt, body: Buffer.from("{}") }))).toEqual({ status: 401 });
    const timestamp = String(Math.floor(Date.now() / 1000) - 601);
    const stale = {
      ...receipt,
      timestamp,
      signature: createWebhookSignature(secret, timestamp, receipt.deliveryId, receipt.body),
    };
    expect(await Effect.runPromise(events.receive(stale))).toEqual({ status: 401 });
    expect(await Effect.runPromise(events.receive({ ...receipt, routeId: "unknown-route" }))).toEqual({ status: 404 });
    decryptFails = true;
    expect(await Effect.runPromise(events.receive(receipt))).toEqual({ status: 503 });
    expect(database.connection.prepare("SELECT receipt_id FROM projection_webhook_receipts").all()).toEqual([]);
    expect(runs()).toEqual([]);
  });

  it("starts one run per delivery ID when the sender retries after a lost acknowledgement", async () => {
    const { database, events, routeId, secret, runs } = await fixture();
    const receipt = signed(routeId, secret, "build-1", BUILD);
    expect(await Effect.runPromise(events.receive(receipt))).toEqual({ status: 202 });
    expect(await Effect.runPromise(events.receive(receipt))).toEqual({ status: 200 });
    // A filter miss is acknowledged, so the sender does not retry it, but it starts nothing.
    const other = signed(routeId, secret, "build-2", { type: "build.completed", data: { branch: "dev" } });
    expect(await Effect.runPromise(events.receive(other))).toEqual({ status: 202 });
    expect(runs()).toHaveLength(1);
    const receipts = database.connection
      .prepare("SELECT delivery_id, status FROM projection_webhook_receipts ORDER BY delivery_id")
      .all();
    expect(receipts).toEqual([
      { delivery_id: "build-1", status: "started" },
      { delivery_id: "build-2", status: "ignored" },
    ]);
  });

  it("shows the secret once, stores only ciphertext, and accepts only the regenerated secret", async () => {
    const { database, events, owner, input, saved, secret, routeId } = await fixture();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(saved.routine.trigger).toEqual({
      kind: "webhook",
      url: `https://signal.example/v1/webhooks/${routeId}`,
      eventType: "build.completed",
      filters: [{ pointer: "/branch", value: "main" }],
    });
    const edited = await Effect.runPromise(events.saveRoutine({ ...input, id: saved.routine.id, name: "Renamed" }));
    expect(edited.secret).toBeNull();
    const stored = JSON.stringify(database.connection.prepare("SELECT * FROM projection_routine_webhooks").all());
    const listed = JSON.stringify(await Effect.runPromise(events.listRoutines({ owner })));
    expect(stored).not.toContain(secret);
    expect(listed).not.toContain(secret);

    const rotated = await Effect.runPromise(events.rotateSecret({ owner, id: saved.routine.id }));
    expect(rotated.secret).not.toBe(secret);
    const old = signed(routeId, secret, "build-1", BUILD);
    expect(await Effect.runPromise(events.receive(old))).toEqual({ status: 401 });
    const fresh = signed(routeId, rotated.secret, "build-1", BUILD);
    expect(await Effect.runPromise(events.receive(fresh))).toEqual({ status: 202 });
  });

  it("revokes the route of a deleted routine, and retries the revocation after Signal was offline", async () => {
    const { events, relay, owner, input, saved, secret, routeId } = await fixture();
    // Switching to a schedule removes the webhook. Switching back makes a new route and secret.
    const scheduled = await Effect.runPromise(
      events.saveRoutine({
        ...input,
        id: saved.routine.id,
        trigger: { kind: "schedule", schedule: { kind: "daily", time: "09:00" } },
      }),
    );
    expect(scheduled.routine.trigger.kind).toBe("schedule");
    expect(relay.revoked).toEqual([routeId]);
    expect(await Effect.runPromise(events.receive(signed(routeId, secret, "build-1", BUILD)))).toEqual({ status: 404 });

    const again = await Effect.runPromise(events.saveRoutine({ ...input, id: saved.routine.id }));
    const secondRoute = relay.registered[1];
    expect(secondRoute).toBeDefined();
    expect(secondRoute).not.toBe(routeId);
    expect(again.secret).not.toBe(secret);

    relay.offline = true;
    await Effect.runPromise(events.deleteRoutine({ owner, id: saved.routine.id }));
    if (!secondRoute || !again.secret) throw new Error("No second route.");
    const late = signed(secondRoute, again.secret, "build-2", BUILD);
    expect(await Effect.runPromise(events.receive(late))).toEqual({ status: 404 });
    expect(relay.revoked).toEqual([routeId]);
    relay.offline = false;
    await Effect.runPromise(events.syncRoutes({ all: false }));
    expect(relay.revoked).toEqual([routeId, secondRoute]);
  });
});

describe("released routine routes", () => {
  it("keeps webhook routines out of the released routine routes", async () => {
    const { service, events, owner, saved, runs } = await fixture();
    const ref = { agentId: owner.id, routineId: saved.routine.id };
    expect(Exit.isFailure(await Effect.runPromiseExit(service.testRoutine(ref)))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(service.deleteRoutine(ref)))).toBe(true);
    expect(runs()).toEqual([]);
    expect(await Effect.runPromise(events.listRoutines({ owner }))).toHaveLength(1);
    // The administrator surface still tests and deletes it.
    await Effect.runPromise(events.testRoutine({ owner, id: saved.routine.id }));
    expect(runs()).toHaveLength(1);
    await Effect.runPromise(events.deleteRoutine({ owner, id: saved.routine.id }));
    expect(await Effect.runPromise(events.listRoutines({ owner }))).toEqual([]);
  });
});

describe("HostEventsService route sync", () => {
  it("replaces a refused route ID, keeps the secret, and does not revoke the old ID", async () => {
    const { events, relay, owner, saved, secret, routeId } = await fixture();
    relay.conflicts.add(routeId);
    await Effect.runPromise(events.syncRoutes({ all: true }));
    const newRoute = relay.registered.at(-1);
    if (!newRoute || newRoute === routeId) throw new Error("No new route was registered.");
    const [listed] = await Effect.runPromise(events.listRoutines({ owner }));
    expect(listed?.trigger).toMatchObject({ url: `https://signal.example/v1/webhooks/${newRoute}` });
    expect(relay.revoked).toEqual([]);
    expect(await Effect.runPromise(events.receive(signed(routeId, secret, "build-1", BUILD)))).toEqual({ status: 404 });
    expect(await Effect.runPromise(events.receive(signed(newRoute, secret, "build-1", BUILD)))).toEqual({
      status: 202,
    });
    expect(listed?.id).toBe(saved.routine.id);
  });
});

describe("signed webhook flow", () => {
  it("starts a run from a signed receipt and lists the receipt as activity", async () => {
    const { events, owner, saved, secret, routeId, runs } = await fixture();
    const routineId = saved.routine.id;
    expect(await Effect.runPromise(events.receive(signed(routeId, secret, "build-flow-1", BUILD)))).toEqual({
      status: 202,
    });
    await waitFor(() => runs()[0]?.status === "running");
    expect(runs()).toHaveLength(1);
    const activity = await Effect.runPromise(events.listActivity({ owner, routineId }));
    expect(activity).toEqual([
      expect.objectContaining({
        kind: "received",
        deliveryId: "build-flow-1",
        status: "started",
        runId: runs()[0]?.id,
      }),
    ]);
    await mkdir(join(process.cwd(), ".openbot-build"), { recursive: true });
    await writeFile(
      join(process.cwd(), ".openbot-build/webhook-signed-flow-report.json"),
      `${JSON.stringify(
        {
          scenario: "signed receipt → routine run",
          runs: runs().length,
          activity: activity.map((entry) => `${entry.kind}:${entry.status}`),
          status: "passed",
        },
        null,
        2,
      )}\n`,
    );
  });
});
