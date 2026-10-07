import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import type { RemoteTicketClaims } from "../src/protocol";
import { SignalService } from "../src/signal-service";
import { runSignal, signalRuntime } from "./signal-runtime";

describe("generic webhook route", () => {
  it("keeps the exact signed bytes until the host acknowledges its commit", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y" }] }),
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const now = Math.floor(Date.now() / 1_000);
    const claims: RemoteTicketClaims = {
      aud: "openbot-remote",
      jti: "host-ticket",
      sessionId: "host-session",
      hostId: "host-1",
      userId: "owner-1",
      membershipId: "host-membership",
      role: "host",
      authEpoch: 1,
      protocolMinimum: 2,
      protocolMaximum: 2,
      sessionExpiresAt: now + 3600,
      iat: now,
      exp: now + 300,
    };
    const signal = new SignalService(
      {
        verifyTicket: () => Effect.succeed({ ...claims, jti: crypto.randomUUID() }),
        verifyResumeToken: () => Effect.succeed(claims),
        validateClaims: () => Effect.succeed(true),
        issueResumeToken: () => Effect.succeed("resume"),
        iceServers: () => [],
        verifyWebhookRoute: () => Effect.succeed({ routes: [{ id: "source-1", linkedAt: 1 }] }),
        validateWebhookRoute: (_hostId, routes) => Effect.succeed(routes.map((route) => route.id)),
      },
      8,
    );
    const app = createRemoteApiApp(config, signal, signalRuntime(signal));
    const messages: string[] = [];
    const socket = {
      id: "ingress",
      ip: "192.0.2.1",
      send(message: string) {
        messages.push(message);
      },
      close() {},
    };
    signal.connect(socket);
    await runSignal(
      signal,
      signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          webhookRoute: "route-ticket",
        }),
      ),
    );
    expect(messages.some((message) => message.includes('"type":"webhook-ready"'))).toBe(true);

    const body = new Uint8Array([123, 34, 116, 121, 112, 101, 34, 58, 34, 116, 101, 115, 116, 34, 125]);
    const pending = app.handle(
      new Request("http://localhost/v1/webhooks/source-1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [WEBHOOK_TIMESTAMP_HEADER]: String(now),
          [WEBHOOK_DELIVERY_ID_HEADER]: "delivery-1",
          [WEBHOOK_SIGNATURE_HEADER]: `sha256=${"a".repeat(64)}`,
        },
        body,
      }),
    );
    await vi.waitFor(() =>
      expect(messages.some((message) => message.includes('"type":"webhook-delivery"'))).toBe(true),
    );
    const delivery = JSON.parse(messages.find((message) => message.includes('"type":"webhook-delivery"')) ?? "{}");
    expect(delivery).toMatchObject({
      routeId: "source-1",
      timestamp: String(now),
      deliveryId: "delivery-1",
      signature: `sha256=${"a".repeat(64)}`,
    });
    expect(Buffer.from(delivery.bodyBase64, "base64")).toEqual(Buffer.from(body));

    await runSignal(
      signal,
      signal.receive(
        socket,
        JSON.stringify({ type: "webhook-delivery-result", version: 1, requestId: delivery.requestId, status: 202 }),
      ),
    );
    expect((await pending).status).toBe(202);
    signal.close();
  });

  it("returns 503 while the host ingress socket is offline", async () => {
    const { app, now } = webhookContext();
    const response = await app.handle(webhookRequest(now));
    expect(response.status).toBe(503);
  });

  it("returns 503 after the route is revoked for a disabled or deleted source", async () => {
    const { app, signal, now } = webhookContext();
    await authenticateWebhook(signal, webhookSocket("ingress"));
    signal.revokeWebhookRoute("source-1", Date.now());
    const response = await app.handle(webhookRequest(now));
    expect(response.status).toBe(503);
  });

  it("rejects a body above the relay limit before reading it", async () => {
    const { app, now } = webhookContext();
    const body = new Uint8Array(WEBHOOK_DELIVERY_BODY_BYTES_LIMIT + 1);
    const response = await app.handle(webhookRequest(now, body, { "Content-Length": String(body.byteLength) }));
    expect(response.status).toBe(413);
  });

  it("accepts an acknowledgement only from the socket that received the delivery", async () => {
    const { app, signal, now } = webhookContext({ timeoutMilliseconds: 100 });
    const first = webhookSocket("first");
    const second = webhookSocket("second");
    await authenticateWebhook(signal, first);
    await authenticateWebhook(signal, second);
    const pending = app.handle(webhookRequest(now));
    await vi.waitFor(() =>
      expect(second.messages.some((message) => message.includes('"type":"webhook-delivery"'))).toBe(true),
    );
    const delivery = JSON.parse(
      second.messages.find((message) => message.includes('"type":"webhook-delivery"')) ?? "{}",
    );
    await runSignal(
      signal,
      signal.receive(
        first,
        JSON.stringify({ type: "webhook-delivery-result", version: 1, requestId: delivery.requestId, status: 400 }),
      ),
    );
    expect(first.messages.some((message) => message.includes('"code":"permission_denied"'))).toBe(true);
    await runSignal(
      signal,
      signal.receive(
        second,
        JSON.stringify({ type: "webhook-delivery-result", version: 1, requestId: delivery.requestId, status: 202 }),
      ),
    );
    expect((await pending).status).toBe(202);
  });
});

function webhookContext(options: { timeoutMilliseconds?: number } = {}) {
  const config = readRemoteApiConfig({
    REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y" }] }),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    REMOTE_SESSION_SECRET: "s".repeat(32),
    REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
    TURN_SHARED_SECRET: "t".repeat(32),
    TURN_HOST: "localhost",
  });
  const now = Math.floor(Date.now() / 1_000);
  const claims: RemoteTicketClaims = {
    aud: "openbot-remote",
    jti: "host-ticket",
    sessionId: "host-session",
    hostId: "host-1",
    userId: "owner-1",
    membershipId: "host-membership",
    role: "host",
    authEpoch: 1,
    protocolMinimum: 2,
    protocolMaximum: 2,
    sessionExpiresAt: now + 3600,
    iat: now,
    exp: now + 300,
  };
  const signal = new SignalService(
    {
      verifyTicket: () => Effect.succeed({ ...claims, jti: crypto.randomUUID() }),
      verifyResumeToken: () => Effect.succeed(claims),
      validateClaims: () => Effect.succeed(true),
      issueResumeToken: () => Effect.succeed("resume"),
      iceServers: () => [],
      verifyWebhookRoute: () => Effect.succeed({ routes: [{ id: "source-1", linkedAt: 1 }] }),
      validateWebhookRoute: (_hostId, routes) => Effect.succeed(routes.map((route) => route.id)),
    },
    8,
    32,
    600,
    undefined,
    {},
    options.timeoutMilliseconds === undefined
      ? undefined
      : {
          timeoutMilliseconds: options.timeoutMilliseconds,
          maximumPendingPerHost: 16,
          maximumPendingBytesPerHost: 128 * 1024,
          maximumPending: 1_000,
        },
  );
  return { app: createRemoteApiApp(config, signal, signalRuntime(signal)), signal, now };
}

function webhookSocket(id: string) {
  const messages: string[] = [];
  return {
    id,
    ip: "192.0.2.1",
    messages,
    send(message: string) {
      messages.push(message);
    },
    close() {},
  };
}

async function authenticateWebhook(signal: SignalService, socket: ReturnType<typeof webhookSocket>) {
  signal.connect(socket);
  await runSignal(
    signal,
    signal.receive(
      socket,
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: "host-ticket",
        webhookRoute: "route-ticket",
      }),
    ),
  );
}

function webhookRequest(
  now: number,
  body = new Uint8Array([123, 34, 116, 121, 112, 101, 34, 58, 34, 116, 101, 115, 116, 34, 125]),
  extraHeaders: Record<string, string> = {},
) {
  return new Request("http://localhost/v1/webhooks/source-1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [WEBHOOK_TIMESTAMP_HEADER]: String(now),
      [WEBHOOK_DELIVERY_ID_HEADER]: crypto.randomUUID(),
      [WEBHOOK_SIGNATURE_HEADER]: `sha256=${"a".repeat(64)}`,
      ...extraHeaders,
    },
    body,
  });
}
