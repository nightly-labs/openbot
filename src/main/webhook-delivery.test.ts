import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ClaimedWebhookDelivery, WebhookDeliveryResult } from "../backend/webhook-destination-store";
import {
  nextWebhookRetryAt,
  prepareWebhookRequest,
  sendWebhookRequest,
  validateDestination,
  validateHeaders,
  validateWebhookTemplate,
  WEBHOOK_DELIVERY_WINDOW_MS,
  WebhookDeliveryWorker,
  type WebhookDeliveryWorkerOptions,
  type WebhookHttpsRequester,
  type WebhookRequestHandle,
  type WebhookRequestInput,
  type WebhookResponseReader,
  type WebhookSecretCipher,
} from "./webhook-delivery";

const SECRET = "webhook-secret-used-only-by-the-test";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const REQUEST: WebhookRequestInput = {
  deliveryId: "event-1:destination-1",
  eventId: "event-1",
  url: "https://hooks.example.test/runs?source=openbot",
  method: "POST",
  secret: SECRET,
  body: Buffer.from('{"status":"succeeded"}', "utf8"),
  nowMs: NOW,
};

class FakeResponse extends EventEmitter implements WebhookResponseReader {
  statusCode?: number;
  headers: Readonly<Record<string, string | string[] | undefined>> = {};

  resume(): void {}
}

class FakeRequest extends EventEmitter implements WebhookRequestHandle {
  destroyed = false;
  readonly #respond: (() => void) | null;

  constructor(respond: (() => void) | null) {
    super();
    this.#respond = respond;
  }

  end(_body: Buffer): this {
    if (this.#respond) queueMicrotask(this.#respond);
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** `status: null` never answers, like a receiver that keeps the socket open. */
function fakeRequester(
  status: number | null,
  seen: { options?: RequestOptions; requests: FakeRequest[] } = { requests: [] },
  retryAfter?: string,
): WebhookHttpsRequester {
  return {
    request(options, callback) {
      seen.options = options;
      const respond =
        status === null
          ? null
          : () => {
              const response = new FakeResponse();
              response.statusCode = status;
              response.headers = retryAfter ? { "retry-after": retryAfter } : {};
              callback(response);
              response.emit("data", Buffer.from("ok"));
              response.emit("end");
            };
      const request = new FakeRequest(respond);
      seen.requests.push(request);
      return request;
    },
  };
}

const publicLookup = { lookup: async () => [{ address: "8.8.8.8", family: 4 as const }] };
const cipher: WebhookSecretCipher = {
  decrypt: (value) => Buffer.from(value).toString("utf8").split("").reverse().join(""),
};
const encrypt = (value: string) => Buffer.from(value.split("").reverse().join(""), "utf8").toString("base64");

function claimed(overrides: Partial<ClaimedWebhookDelivery> = {}): ClaimedWebhookDelivery {
  return {
    id: "event-1:destination-1",
    destinationId: "destination-1",
    eventId: "event-1",
    eventType: "routine.run.succeeded",
    attempt: 1,
    windowStartedAt: new Date(NOW).toISOString(),
    url: "https://hooks.example.test",
    method: "POST",
    payload: { status: "succeeded" },
    secretCiphertext: encrypt(SECRET),
    headersCiphertext: null,
    ...overrides,
  };
}

function fakeStore(rows: () => ClaimedWebhookDelivery[], sendable = () => true) {
  const settled: Array<{ id: string; result: WebhookDeliveryResult }> = [];
  const released: string[] = [];
  const store: WebhookDeliveryWorkerOptions["store"] = {
    claim: rows,
    isSendable: sendable,
    release: (id) => {
      released.push(id);
    },
    settle: (id, result) => {
      settled.push({ id, result });
    },
  };
  return { store, settled, released };
}

describe("webhook delivery request", () => {
  it("signs the delivery ID and the exact body, and sends no signature without a secret", () => {
    const signed = prepareWebhookRequest(REQUEST);
    const timestamp = String(Math.floor(NOW / 1000));
    const expected = createHmac("sha256", SECRET)
      .update(`${timestamp}.${REQUEST.deliveryId}.${Buffer.from(REQUEST.body).toString("utf8")}`)
      .digest("hex");
    expect(signed.headers).toMatchObject({
      "x-openbot-event-id": "event-1",
      "x-openbot-delivery-id": "event-1:destination-1",
      "x-openbot-timestamp": timestamp,
      "x-openbot-signature": `sha256=${expected}`,
    });
    expect(signed.body).toEqual(Buffer.from(REQUEST.body));

    const unsigned = prepareWebhookRequest({ ...REQUEST, secret: null });
    expect(unsigned.headers).not.toHaveProperty("x-openbot-signature");
  });

  it("rejects unsafe destinations, headers, and template fields", () => {
    expect(() => validateDestination({ url: "http://8.8.8.8/", method: "POST" })).toThrowError(
      expect.objectContaining({ code: "invalid_destination" }),
    );
    expect(() => validateDestination({ url: "https://user:pass@hooks.example.test/", method: "POST" })).toThrowError(
      expect.objectContaining({ code: "invalid_destination" }),
    );
    expect(() => validateDestination({ url: "https://127.0.0.1/", method: "POST" })).toThrowError(
      expect.objectContaining({ code: "private_destination" }),
    );
    expect(() => validateHeaders({ Host: "evil.example" })).toThrowError(
      expect.objectContaining({ code: "invalid_headers" }),
    );
    expect(() => validateHeaders({ "X-OpenBot-Signature": "forged" })).toThrowError(
      expect.objectContaining({ code: "invalid_headers" }),
    );
    expect(() => validateWebhookTemplate({ value: "{{event.data.secret}}" })).toThrowError(
      expect.objectContaining({ code: "invalid_template" }),
    );
    expect(() => validateWebhookTemplate({ run: "{{event.runId}}", status: "{{status}}" })).not.toThrow();
  });

  it("rejects a DNS rebinding answer and pins the checked address in both lookup forms", async () => {
    const rebinding = {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 as const },
        { address: "127.0.0.1", family: 4 as const },
      ],
    };
    await expect(
      Effect.runPromise(sendWebhookRequest(REQUEST, { lookup: rebinding, request: fakeRequester(204) })),
    ).rejects.toMatchObject({ code: "private_destination" });

    const seen: { options?: RequestOptions; requests: FakeRequest[] } = { requests: [] };
    await Effect.runPromise(sendWebhookRequest(REQUEST, { lookup: publicLookup, request: fakeRequester(204, seen) }));
    expect(seen.options).toMatchObject({ hostname: "hooks.example.test", agent: false });
    const pinned = seen.options?.lookup;
    expect(pinned).toBeDefined();
    const single: unknown[] = [];
    pinned?.("hooks.example.test", {}, (...result) => single.push(...result));
    expect(single).toEqual([null, "8.8.8.8", 4]);
    // Node asks for every address when automatic family selection is on.
    const all: unknown[] = [];
    pinned?.("hooks.example.test", { all: true }, (...result) => all.push(...result));
    expect(all).toEqual([null, [{ address: "8.8.8.8", family: 4 }]]);
  });

  it("ends a request that is still open at the total deadline", async () => {
    const seen: { options?: RequestOptions; requests: FakeRequest[] } = { requests: [] };
    await expect(
      Effect.runPromise(
        sendWebhookRequest(REQUEST, { lookup: publicLookup, request: fakeRequester(null, seen), deadlineMs: 20 }),
      ),
    ).rejects.toMatchObject({ code: "request_failed" });
    expect(seen.requests[0]?.destroyed).toBe(true);
  });
});

describe("webhook retry scheduler", () => {
  it("uses the initial attempt plus five retries and honors Retry-After within the window", () => {
    expect(nextWebhookRetryAt(0, NOW, undefined)).toBe(NOW + 10_000);
    expect(nextWebhookRetryAt(1, NOW, "120")).toBe(NOW + 120_000);
    expect(nextWebhookRetryAt(5, NOW, undefined)).toBeNull();
    expect(nextWebhookRetryAt(0, NOW, "86400", NOW + 60_000)).toBeNull();
    expect(WEBHOOK_DELIVERY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("queues a retry after a server error and keeps the secret out of the result", async () => {
    const { store, settled } = fakeStore(() => [claimed()]);
    const worker = new WebhookDeliveryWorker({
      store,
      cipher,
      lookup: publicLookup,
      request: fakeRequester(500),
      now: () => NOW,
    });
    await expect(Effect.runPromise(worker.runDue())).resolves.toEqual({
      processed: 1,
      succeeded: 0,
      retried: 1,
      failed: 0,
    });
    expect(settled).toEqual([
      {
        id: "event-1:destination-1",
        result: { status: "queued", statusCode: 500, nextAttemptAt: "2026-10-07T12:00:10.000Z" },
      },
    ]);
    expect(JSON.stringify(settled)).not.toContain(SECRET);
  });

  it("retries a DNS failure and fails a client error at once", async () => {
    const offline = {
      lookup: async () => {
        throw new Error("offline");
      },
    };
    const dns = fakeStore(() => [claimed({ secretCiphertext: null })]);
    await Effect.runPromise(
      new WebhookDeliveryWorker({ store: dns.store, cipher, lookup: offline, now: () => NOW }).runDue(),
    );
    expect(dns.settled[0]?.result).toMatchObject({ status: "queued", nextAttemptAt: "2026-10-07T12:00:10.000Z" });

    const rejected = fakeStore(() => [claimed()]);
    await Effect.runPromise(
      new WebhookDeliveryWorker({
        store: rejected.store,
        cipher,
        lookup: publicLookup,
        request: fakeRequester(400),
        now: () => NOW,
      }).runDue(),
    );
    expect(rejected.settled[0]?.result).toEqual({ status: "failed", statusCode: 400 });
  });

  it("releases a row that became unsendable and fails a row after six attempts", async () => {
    let sendable = false;
    const { store, settled, released } = fakeStore(
      () => [claimed({ attempt: sendable ? 7 : 1 })],
      () => sendable,
    );
    const seen: { options?: RequestOptions; requests: FakeRequest[] } = { requests: [] };
    const worker = new WebhookDeliveryWorker({
      store,
      cipher,
      lookup: publicLookup,
      request: fakeRequester(204, seen),
      now: () => NOW,
    });
    await Effect.runPromise(worker.runDue());
    expect(released).toEqual(["event-1:destination-1"]);
    sendable = true;
    await expect(Effect.runPromise(worker.runDue())).resolves.toMatchObject({ failed: 1 });
    expect(settled.map(({ result }) => result.status)).toEqual(["failed"]);
    expect(seen.requests).toHaveLength(0);
  });
});
