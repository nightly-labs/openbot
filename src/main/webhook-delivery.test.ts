import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildWebhookBody,
  nextWebhookRetryAt,
  type OutboundWebhookEvent,
  prepareWebhookRequest,
  type StoredWebhookDelivery,
  sendWebhookAttempt,
  validateDestination,
  validateHeaders,
  validateWebhookTemplate,
  WEBHOOK_DELIVERY_WINDOW_MS,
  WebhookDeliveryError,
  type WebhookDeliveryStore,
  WebhookDeliveryWorker,
  type WebhookHttpsRequester,
  type WebhookRequestHandle,
  type WebhookResponseReader,
  type WebhookSecretCipher,
} from "./webhook-delivery";

const EVENT: OutboundWebhookEvent = {
  id: "run-1:succeeded",
  type: "routine.run.succeeded",
  runId: "run-1",
  occurredAt: "2026-10-07T12:00:00.000Z",
  routineId: "routine-1",
  routineName: "Daily report",
  status: "succeeded",
};
const SECRET = "webhook-secret-used-only-by-the-test";

class FakeResponse extends EventEmitter implements WebhookResponseReader {
  statusCode?: number;
  headers: Readonly<Record<string, string | string[] | undefined>> = {};

  resume(): void {}
}

class FakeRequest extends EventEmitter implements WebhookRequestHandle {
  readonly #response: FakeResponse;
  readonly #callback: (response: WebhookResponseReader) => void;

  constructor(response: FakeResponse, callback: (response: WebhookResponseReader) => void) {
    super();
    this.#response = response;
    this.#callback = callback;
  }

  setTimeout(_milliseconds: number, _listener: () => void): this {
    return this;
  }

  end(_body: Buffer): this {
    queueMicrotask(() => {
      this.#callback(this.#response);
      this.#response.emit("data", Buffer.from("ok"));
      this.#response.emit("end");
    });
    return this;
  }

  destroy(): this {
    return this;
  }
}

function fakeRequester(
  status: number,
  retryAfter?: string,
  seen?: { options?: RequestOptions; body?: Buffer },
): WebhookHttpsRequester {
  return {
    request(options, callback) {
      if (seen) seen.options = options;
      const response = new FakeResponse();
      response.statusCode = status;
      response.headers = retryAfter ? { "retry-after": retryAfter } : {};
      const request = new FakeRequest(response, callback);
      return request;
    },
  };
}

const publicLookup = { lookup: async () => [{ address: "8.8.8.8", family: 4 as const }] };
const cipher: WebhookSecretCipher = {
  decrypt: (value) => Buffer.from(value).toString("utf8").split("").reverse().join(""),
};

describe("webhook delivery request", () => {
  it("renders only documented fields and signs a stable body", async () => {
    const destination = {
      url: "https://hooks.example.test/runs?source=openbot",
      method: "POST" as const,
      template: { id: "{{event.id}}", status: "{{event.status}}", nested: { type: "{{event.type}}" } },
    };
    const first = prepareWebhookRequest({
      event: EVENT,
      destination,
      secret: SECRET,
      nowMs: Date.parse(EVENT.occurredAt),
    });
    const second = prepareWebhookRequest({
      event: EVENT,
      destination,
      secret: SECRET,
      nowMs: Date.parse(EVENT.occurredAt) + 10_000,
    });
    expect(first.body).toEqual(second.body);
    expect(first.body.toString()).toBe(
      '{"id":"run-1:succeeded","nested":{"type":"routine.run.succeeded"},"status":"succeeded"}',
    );
    expect(first.headers["x-openbot-signature"]).not.toBe(second.headers["x-openbot-signature"]);

    const storedBody = Buffer.from('{"custom":"template"}', "utf8");
    const stored = prepareWebhookRequest({
      event: { id: EVENT.id, type: EVENT.type },
      destination,
      secret: SECRET,
      body: storedBody,
      nowMs: Date.parse(EVENT.occurredAt),
    });
    expect(stored.body).toEqual(storedBody);

    await expect(
      Effect.runPromise(
        sendWebhookAttempt(
          { event: EVENT, destination, secret: SECRET, nowMs: Date.now() },
          { lookup: publicLookup, request: fakeRequester(202) },
        ),
      ),
    ).resolves.toMatchObject({ outcome: "succeeded", status: 202 });
  });

  it("rejects unsafe destinations, headers, and executable-looking template paths", () => {
    expect(() => validateDestination({ url: "http://8.8.8.8/", method: "POST" })).toThrowError(
      expect.objectContaining({ code: "invalid_destination" }),
    );
    expect(() => validateDestination({ url: "https://127.0.0.1/", method: "POST" })).toThrowError(
      expect.objectContaining({ code: "private_destination" }),
    );
    expect(() => validateHeaders({ Host: "evil.example" })).toThrowError(
      expect.objectContaining({ code: "invalid_headers" }),
    );
    expect(() => validateWebhookTemplate({ value: "{{event.data.secret}}" })).toThrowError(
      expect.objectContaining({ code: "invalid_template" }),
    );
    expect(() => buildWebhookBody(EVENT, { bad: undefined })).toThrowError(
      expect.objectContaining({ code: "invalid_template" }),
    );
  });

  it("rejects a DNS rebinding answer and pins the selected public address", async () => {
    const seen: { options?: RequestOptions; body?: Buffer } = {};
    const rebinding = {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 as const },
        { address: "127.0.0.1", family: 4 as const },
      ],
    };
    await expect(
      Effect.runPromise(
        sendWebhookAttempt(
          { event: EVENT, destination: { url: "https://hooks.example.test", method: "POST" }, secret: SECRET },
          { lookup: rebinding, request: fakeRequester(204, undefined, seen) },
        ),
      ),
    ).rejects.toMatchObject({ code: "private_destination" });

    await Effect.runPromise(
      sendWebhookAttempt(
        { event: EVENT, destination: { url: "https://hooks.example.test", method: "POST" }, secret: SECRET },
        { lookup: publicLookup, request: fakeRequester(204, undefined, seen) },
      ),
    );
    expect(seen.options?.hostname).toBe("hooks.example.test");
    expect(seen.options?.agent).toBe(false);
    const pinned = seen.options?.lookup;
    expect(pinned).toBeDefined();
    const resolved: { address?: string; family?: number } = {};
    pinned?.("hooks.example.test", {}, (error, address, family) => {
      expect(error).toBeNull();
      resolved.address = typeof address === "string" ? address : address[0]?.address;
      resolved.family = family;
    });
    expect(resolved).toEqual({ address: "8.8.8.8", family: 4 });
  });
});

describe("webhook retry scheduler", () => {
  it("uses the initial plus five retry slots and honors Retry-After within the deadline", () => {
    const now = Date.parse("2026-10-07T12:00:00.000Z");
    expect(nextWebhookRetryAt(0, now, undefined)).toBe(now + 10_000);
    expect(nextWebhookRetryAt(1, now, "120")).toBe(now + 120_000);
    expect(nextWebhookRetryAt(5, now, undefined)).toBeNull();
    expect(nextWebhookRetryAt(0, now, "86400", now + 60_000)).toBeNull();
    expect(WEBHOOK_DELIVERY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("marks a failed request without exposing secret or response details", async () => {
    const storedSecret = Buffer.from(SECRET.split("").reverse().join(""), "utf8").toString("base64");
    const row: StoredWebhookDelivery = {
      id: "delivery-1",
      eventId: EVENT.id,
      eventType: EVENT.type,
      url: "https://hooks.example.test",
      method: "POST",
      payload: { custom: "rendered template" },
      secretCiphertext: storedSecret,
      headersCiphertext: null,
      attempt: 0,
      createdAt: "2026-10-07T12:00:00.000Z",
      nextAttemptAt: "2026-10-07T12:00:00.000Z",
      status: "sending",
    };
    const calls: Array<{ id: string; result: unknown }> = [];
    const store: WebhookDeliveryStore = {
      claimDeliveries: () => [row],
      isDeliverySendable: () => true,
      releaseDelivery: () => undefined,
      markDelivery: (id, result) => calls.push({ id, result }),
    };
    const worker = new WebhookDeliveryWorker({ store, cipher, lookup: publicLookup, request: fakeRequester(500) });
    const result = await Effect.runPromise(worker.runDue(Date.parse(row.createdAt)));
    expect(result).toEqual({ processed: 1, succeeded: 0, retried: 1, failed: 0 });
    expect(calls[0]?.result).toMatchObject({ status: "queued", statusCode: 500 });
    expect(JSON.stringify(calls)).not.toContain(SECRET);
    expect(new WebhookDeliveryError({ code: "request_failed" }).message).not.toContain(SECRET);
  });

  it("retries DNS failures as network failures", async () => {
    const row: StoredWebhookDelivery = {
      id: "delivery-dns",
      eventId: EVENT.id,
      eventType: EVENT.type,
      url: "https://hooks.example.test",
      method: "POST",
      payload: { custom: "rendered template" },
      secretCiphertext: Buffer.from(SECRET, "utf8").toString("base64"),
      headersCiphertext: null,
      attempt: 0,
      createdAt: "2026-10-07T12:00:00.000Z",
      nextAttemptAt: "2026-10-07T12:00:00.000Z",
      status: "sending",
    };
    const calls: Array<{ id: string; result: unknown }> = [];
    const store: WebhookDeliveryStore = {
      claimDeliveries: () => [row],
      isDeliverySendable: () => true,
      releaseDelivery: () => undefined,
      markDelivery: (id, result) => calls.push({ id, result }),
    };
    const offlineLookup = {
      lookup: async () => {
        throw new Error("offline");
      },
    };
    const worker = new WebhookDeliveryWorker({
      store,
      cipher,
      lookup: offlineLookup,
      request: fakeRequester(204),
      now: () => Date.parse(row.createdAt),
    });
    const result = await Effect.runPromise(worker.runDue(Date.parse(row.createdAt)));
    expect(result).toEqual({ processed: 1, succeeded: 0, retried: 1, failed: 0 });
    expect(calls[0]?.result).toMatchObject({
      status: "queued",
      nextAttemptAt: "2026-10-07T12:00:10.000Z",
    });
  });

  it("does not send a claimed row after disable or after all six attempts", async () => {
    const storedSecret = Buffer.from(SECRET, "utf8").toString("base64");
    const row: StoredWebhookDelivery = {
      id: "delivery-disabled",
      eventId: EVENT.id,
      eventType: EVENT.type,
      url: "https://hooks.example.test",
      method: "POST",
      payload: { eventType: EVENT.type, runId: EVENT.runId, status: "succeeded", occurredAt: EVENT.occurredAt },
      secretCiphertext: storedSecret,
      headersCiphertext: null,
      attempt: 0,
      createdAt: "2026-10-07T12:00:00.000Z",
      nextAttemptAt: "2026-10-07T12:00:00.000Z",
      status: "sending",
    };
    const calls: Array<{ id: string; result: unknown }> = [];
    const releases: string[] = [];
    let sendable = false;
    const store: WebhookDeliveryStore = {
      claimDeliveries: () => [{ ...row, attempt: sendable ? 6 : 0 }],
      isDeliverySendable: () => sendable,
      releaseDelivery: (id) => releases.push(id),
      markDelivery: (id, result) => calls.push({ id, result }),
    };
    const request = fakeRequester(204);
    const worker = new WebhookDeliveryWorker({ store, cipher, lookup: publicLookup, request });
    await expect(Effect.runPromise(worker.runDue(Date.parse(row.createdAt)))).resolves.toMatchObject({ failed: 0 });
    sendable = true;
    await expect(Effect.runPromise(worker.runDue(Date.parse(row.createdAt)))).resolves.toMatchObject({ failed: 1 });
    expect(releases).toEqual([row.id]);
    expect(calls).toHaveLength(1);
    const statuses = calls.map(({ result }) =>
      result && typeof result === "object" && "status" in result ? result.status : null,
    );
    expect(statuses).toEqual(["failed"]);
  });
});
