// @vitest-environment node

import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
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
import { EventStore } from "../backend/event-store";
import { HostEventsService } from "./host-events-service";
import { WebhookDeliveryWorker, type WebhookHttpsRequester, type WebhookResponseReader } from "./webhook-delivery";
import { createWebhookSignature, verifyWebhookSignature } from "./webhook-security";

// Failure modes: a duplicate starts another run; retries change the signed payload;
// disabling sends pending data; notifications expose instructions or credentials.
const sourceSecret = "source-signing-secret-for-event-flow-check";
const destinationSecret = "destination-signing-secret-for-event-flow-check";
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join("")),
  decrypt: (value: Buffer) => [...value.toString()].reverse().join(""),
};
let root: string | null = null;
let agentService: AgentService | null = null;

afterEach(async () => {
  if (root) await stopAgentTestFixture(root, agentService);
  root = null;
  agentService = null;
});

class Reply extends EventEmitter implements WebhookResponseReader {
  headers = {};
  constructor(readonly statusCode: number) {
    super();
  }
  resume(): void {}
}

class Request extends EventEmitter {
  constructor(
    readonly reply: Reply,
    readonly callback: (reply: WebhookResponseReader) => void,
    readonly capture: (body: Buffer) => void,
  ) {
    super();
  }
  setTimeout(): this {
    return this;
  }
  destroy(): this {
    return this;
  }
  end(body: Buffer): this {
    this.capture(body);
    queueMicrotask(() => {
      this.callback(this.reply);
      this.reply.emit("end");
    });
    return this;
  }
}

describe("signed webhook flow", () => {
  it("commits one run and sends the same notification after disable, enable, and retry", async () => {
    const fixture = await startAgentTestFixture();
    root = fixture.root;
    const { store, mailbox } = stores(root);
    await Effect.runPromise(store.initialize());
    await Effect.runPromise(mailbox.initialize());
    const agent = await Effect.runPromise(store.getOrCreate("webhook-flow-agent"));
    const service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "", false),
    });
    agentService = service;
    await Effect.runPromise(service.initialize());
    const events = new HostEventsService({
      database: store.database,
      cipher,
      routines: service.eventRoutines,
      relay: {
        connected: () => true,
        registerSource: (id) => Effect.succeed(`https://signal.example/v1/webhooks/${id}`),
        revokeSource: () => Effect.void,
      },
      wake: () => undefined,
    });
    const source = await Effect.runPromise(
      events.saveSource({ name: "Build source", active: true, secret: sourceSecret }),
    );
    const routine = await Effect.runPromise(
      events.saveRoutine({
        owner: { kind: "agent", id: agent.id },
        name: "Build review",
        instruction: "PRIVATE SAVED INSTRUCTION",
        active: true,
        timezone: "UTC",
        trigger: {
          kind: "event",
          sourceId: source.id,
          eventType: "build.completed",
          filters: [{ pointer: "/branch", value: "main" }],
        },
      }),
    );
    const destination = await Effect.runPromise(
      events.saveDestination({
        name: "Run receiver",
        active: true,
        url: "https://receiver.example/runs",
        method: "POST",
        eventTypes: ["routine.run.started"],
        routineIds: [routine.id],
        payloadTemplate: { run: "{{event.runId}}", status: "{{event.status}}" },
        secret: destinationSecret,
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from(
      JSON.stringify({ type: "build.completed", data: { branch: "main", text: "UNTRUSTED EVENT CONTENT" } }),
    );
    const receipt = {
      sourceId: source.id,
      deliveryId: "build-flow-1",
      timestamp,
      body,
      signature: createWebhookSignature(sourceSecret, timestamp, "build-flow-1", body),
    };
    expect(await Effect.runPromise(events.receive(receipt))).toEqual({ status: 202 });
    expect(await Effect.runPromise(events.receive(receipt))).toEqual({ status: 202 });
    await Effect.runPromise(events.dispatch());
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);
    await waitFor(
      () => service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })[0]?.status === "running",
    );
    expect(service.listRoutineRuns({ agentId: agent.id, routineId: routine.id, limit: 10 })).toHaveLength(1);

    const sent: Array<{ body: Buffer; eventId: string }> = [];
    let now = Date.now();
    const request: WebhookHttpsRequester = {
      request(options, callback) {
        const headers = options.headers;
        if (!isDynamicRecord(headers)) throw new Error("Missing signed headers.");
        const timestamp = headers["x-openbot-timestamp"];
        const deliveryId = headers["x-openbot-delivery-id"];
        const signature = headers["x-openbot-signature"];
        if (typeof timestamp !== "string" || typeof deliveryId !== "string" || typeof signature !== "string")
          throw new Error("Invalid signed headers.");
        return new Request(new Reply(sent.length === 0 ? 503 : 202), callback, (body) => {
          verifyWebhookSignature(destinationSecret, { timestamp, deliveryId, body, nowMs: now }, signature);
          sent.push({ body, eventId: deliveryId });
        });
      },
    };
    const eventStore = new EventStore(store.database);
    const worker = new WebhookDeliveryWorker({
      store: eventStore,
      cipher,
      request,
      lookup: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
      now: () => now,
    });
    expect(await Effect.runPromise(worker.runDue(now))).toMatchObject({ processed: 1, retried: 1 });
    await Effect.runPromise(events.saveDestination({ ...destination, active: false }));
    now += 10_001;
    expect(await Effect.runPromise(worker.runDue(now))).toMatchObject({ processed: 0 });
    await Effect.runPromise(events.saveDestination({ ...destination, active: true }));
    expect(await Effect.runPromise(worker.runDue(now))).toMatchObject({ processed: 1, succeeded: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]?.body.toString()).not.toContain("PRIVATE SAVED INSTRUCTION");
    expect(sent[0]?.body.toString()).not.toContain("UNTRUSTED EVENT CONTENT");
    expect(sent[0]?.body.toString()).not.toContain(destinationSecret);
    expect(eventStore.listActivity(100)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "delivery", status: "succeeded" })]),
    );
    await mkdir(join(process.cwd(), ".openbot-build"), { recursive: true });
    await writeFile(
      join(process.cwd(), ".openbot-build/webhook-signed-flow-report.json"),
      `${JSON.stringify({ scenario: "signed receipt → real routine queue → signed notification", runs: 1, attempts: sent.length, disabledAttempts: 0, samePayload: true, status: "passed" }, null, 2)}\n`,
    );
  });
});
