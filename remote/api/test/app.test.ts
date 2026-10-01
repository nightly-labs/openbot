import { createHmac, generateKeyPairSync } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp, signalClientIp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import type { RemoteTicketClaims } from "../src/protocol";
import { type RemoteTokenProvider, SignalService } from "../src/signal-service";
import { RemoteTokenService, signServiceRequest } from "../src/tokens";

describe("Remote API proxy addresses", () => {
  it("uses the first forwarded address only when the proxy is trusted", () => {
    expect(signalClientIp("127.0.0.1", "198.51.100.20, 127.0.0.1", true)).toBe("198.51.100.20");
    expect(signalClientIp("203.0.113.8", "198.51.100.20", false)).toBe("203.0.113.8");
  });
});

describe("Remote API development configuration", () => {
  it("uses the Auth API public JWKS binding for a local Signal service", () => {
    expect(
      readRemoteApiConfig({
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "192.168.1.143",
      }).ticketJwks,
    ).toBe('{"keys":[]}');
  });
});

describe("signed account notifications", () => {
  it("verifies the exact HTTP body before delivering profile invalidation", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const signal = new SignalService(new RemoteTokenService(config), 8);
    const changed = vi.spyOn(signal, "profileChanged");
    const app = createRemoteApiApp(config, signal);
    const body = '{ "type": "account-profile-changed", "userId": "user-1" }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signServiceRequest(body, timestamp, config.authWebhookSecret);
    const send = (payload: string, signed: string) =>
      app.handle(
        new Request("http://localhost/internal/auth-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signed },
          body: payload,
        }),
      );
    const response = await send(body, signature);
    expect(response.status, await response.text()).toBe(204);
    expect(changed).toHaveBeenCalledWith("user-1");
    changed.mockClear();
    expect((await send(body.replace("user-1", "user-2"), signature)).status).toBe(401);
    expect((await send(body, "")).status).toBe(401);
    expect(changed).not.toHaveBeenCalled();
  });

  it("forwards a changed server list to the account that joined or lost one", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const signal = new SignalService(new RemoteTokenService(config), 8);
    const changed = vi.spyOn(signal, "serversChanged");
    const app = createRemoteApiApp(config, signal);
    const body = '{ "type": "account-servers-changed", "userId": "user-1" }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await app.handle(
      new Request("http://localhost/internal/auth-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OpenBot-Timestamp": timestamp,
          "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
        },
        body,
      }),
    );
    expect(response.status, await response.text()).toBe(204);
    expect(changed).toHaveBeenCalledWith("user-1");
  });
});

// Slack posts to Signal from the internet, so each refusal here is a security check: nothing reaches
// a host unless Slack signed it with the app's signing secret, and a host receives only the
// workspaces that a route ticket from the account service links to it.
describe("Slack request route", () => {
  const signingSecret = "8f742231b10e8888abcd99yyyzzz85a5";

  it("checks Slack's signature and passes the request to the workspace's host", async () => {
    const { app, signal, route } = await slackRoute(signingSecret);
    const body = '{"type":"event_callback","team_id":"T1","event_id":"Ev1","event":{"type":"app_mention"}}';

    // Nothing unsigned passes, and a challenge is answered with no host.
    expect((await post(app, body, { signature: `v0=${"a".repeat(64)}` })).status).toBe(401);
    expect((await post(app, body, { timestamp: "1" })).status).toBe(401);
    expect((await post(app, body.replace("T1", "T2"), { signedBody: body })).status).toBe(401);
    expect((await post(app, body, { contentType: "text/plain" })).status).toBe(415);
    expect((await post(app, "x".repeat(64 * 1024 + 1))).status).toBe(413);
    expect((await post(app, '{"type":"event_callback"}')).status).toBe(400);
    const challenge = await post(app, '{"type":"url_verification","challenge":"abc"}');
    expect(challenge.status).toBe(200);
    expect(await challenge.text()).toBe("abc");
    expect((await post(app, body)).status).toBe(503);

    // An ingress socket needs a route ticket for its own host, and it is not expired.
    const refused = async (slackRoute: string | undefined) => {
      const socket = testSocket(crypto.randomUUID());
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({ type: "hello", version: 1, peer: "ingress", token: "t", slackRoute }),
      );
      return socket.messages.at(-1) ?? "";
    };
    expect(await refused(undefined)).toContain('"code":"authentication_required"');
    expect(await refused(await route({ hid: "host-2", teams: ["T1"] }))).toContain('"code":"authentication_required"');
    expect(await refused(await route({ hid: "host-1", teams: ["T1"] }, -60))).toContain(
      '"code":"authentication_required"',
    );

    const ingress = testSocket("ingress");
    signal.connect(ingress);
    await signal.receive(
      ingress,
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: "host-ticket",
        slackRoute: await route({ hid: "host-1", teams: ["T1"] }),
      }),
    );
    expect(ingress.messages.at(-1)).toContain('"type":"ready"');
    ingress.messages.length = 0;

    // A workspace that the ticket does not name still has no host.
    expect((await post(app, body.replace("T1", "T9"))).status).toBe(503);

    const pending = post(app, body);
    await vi.waitFor(() => expect(ingress.messages).toHaveLength(1));
    const delivery = JSON.parse(ingress.messages[0] ?? "{}");
    expect(delivery).toMatchObject({ type: "slack-delivery", teamId: "T1", kind: "events" });
    expect(Buffer.from(delivery.bodyBase64, "base64").toString()).toBe(body);

    // Another socket cannot answer a request that Signal did not send it.
    const other = testSocket("other");
    signal.connect(other);
    await signal.receive(
      other,
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: "host-ticket",
        slackRoute: await route({ hid: "host-1", teams: [] }),
      }),
    );
    const answer = { type: "slack-delivery-result", version: 1, requestId: delivery.requestId, status: 200 };
    await signal.receive(other, JSON.stringify(answer));
    expect(other.messages.at(-1)).toContain('"code":"permission_denied"');

    await signal.receive(ingress, JSON.stringify(answer));
    expect((await pending).status).toBe(200);

    // A button press carries the workspace inside the form's `payload`.
    const press = `payload=${encodeURIComponent('{"type":"block_actions","team":{"id":"T1"}}')}`;
    const pressed = post(app, press, { contentType: "application/x-www-form-urlencoded" });
    await vi.waitFor(() => expect(ingress.messages).toHaveLength(2));
    expect(JSON.parse(ingress.messages[1] ?? "{}")).toMatchObject({ teamId: "T1", kind: "interactivity" });
    signal.disconnect(ingress);
    expect((await pressed).status).toBe(503);
  });

  it("keeps a workspace with its newest link, and drops a revoked one", async () => {
    const { app, signal, route, revoke } = await slackRoute(signingSecret);
    const connect = async (id: string, linkedAt: number) => {
      const socket = testSocket(id);
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, linkedAt),
        }),
      );
      expect(socket.messages.at(-1)).toContain('"type":"ready"');
      socket.messages.length = 0;
      return socket;
    };
    const body = '{"type":"event_callback","team_id":"T1","event_id":"Ev2","event":{"type":"app_mention"}}';
    const delivered = async (socket: TestSocket) => {
      const pending = post(app, body);
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await signal.receive(
        socket,
        JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }),
      );
      expect((await pending).status).toBe(200);
    };

    // The workspace moved to a new host. The host that lost it still holds an unexpired ticket with
    // the older link, and connects after the new one.
    const current = await connect("current", 2_000);
    const stale = await connect("stale", 1_000);
    await delivered(current);
    expect(stale.messages).toHaveLength(0);

    // Unlinked: the route goes at once, and the last ticket cannot bring it back.
    await revoke("T1", 2_500);
    expect((await post(app, body)).status).toBe(503);
    await connect("replay", 2_000);
    expect((await post(app, body)).status).toBe(503);

    // A later link answers again. A revocation older than the current link changes nothing.
    const relinked = await connect("relinked", 3_000);
    await revoke("T1", 2_999);
    await delivered(relinked);
  });

  it("answers 503 when the signing secret is not configured", async () => {
    const { app } = await slackRoute(null);
    expect((await post(app, '{"type":"url_verification","challenge":"abc"}')).status).toBe(503);
  });

  function post(
    app: ReturnType<typeof createRemoteApiApp>,
    body: string,
    options: { contentType?: string; timestamp?: string; signature?: string; signedBody?: string } = {},
  ) {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1_000));
    const signature =
      options.signature ??
      `v0=${createHmac("sha256", signingSecret)
        .update(`v0:${timestamp}:${options.signedBody ?? body}`)
        .digest("hex")}`;
    return app.handle(
      new Request("http://localhost/v1/slack/events", {
        method: "POST",
        headers: {
          "Content-Type": options.contentType ?? "application/json",
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Signature": signature,
        },
        body,
      }),
    );
  }
});

async function slackRoute(signingSecret: string | null) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "slack-route-1";
  jwk.alg = "ES256";
  const config = readRemoteApiConfig({
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [jwk] }),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    REMOTE_SESSION_SECRET: "s".repeat(32),
    REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
    TURN_SHARED_SECRET: "t".repeat(32),
    TURN_HOST: "localhost",
    // The development app's secret is listed too: one Signal serves both apps.
    ...(signingSecret ? { SLACK_SIGNING_SECRET: `${"d".repeat(32)}, ${signingSecret}` } : {}),
  });
  const routes = new RemoteTokenService(config);
  const signal = new SignalService(
    { ...hostTickets(), verifySlackRoute: (token, hostId) => routes.verifySlackRoute(token, hostId) },
    8,
  );
  const now = Math.floor(Date.now() / 1_000);
  const route = (claims: { hid: string; teams: string[] }, lifetimeSeconds = 3_600, linkedAt = 1_000) =>
    new SignJWT({ hid: claims.hid, teams: claims.teams.map((id) => ({ id, linkedAt })) })
      .setProtectedHeader({ alg: "ES256", kid: "slack-route-1" })
      .setAudience("openbot-slack-route")
      .setIssuedAt(now - 120)
      .setExpirationTime(now + lifetimeSeconds)
      .sign(privateKey);
  const app = createRemoteApiApp(config, signal);
  // What the account service sends when it unlinks or moves a workspace.
  const revoke = async (teamId: string, through: number) => {
    const body = JSON.stringify({ type: "slack-route-revoked", teamId, through });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const response = await app.handle(
      new Request("http://localhost/internal/auth-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OpenBot-Timestamp": timestamp,
          "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
        },
        body,
      }),
    );
    expect(response.status).toBe(204);
  };
  return { app, signal, route, revoke };
}

interface TestSocket {
  id: string;
  ip: string;
  messages: string[];
  send(message: string): void;
  close(): void;
}

function testSocket(id: string): TestSocket {
  const messages: string[] = [];
  return { id, ip: "192.0.2.1", messages, send: (message) => messages.push(message), close: () => {} };
}

function hostTickets(): RemoteTokenProvider {
  const now = Math.floor(Date.now() / 1_000);
  const claims: RemoteTicketClaims = {
    aud: "openbot-remote",
    jti: "host-jti",
    sessionId: "host-session",
    hostId: "host-1",
    userId: "owner-1",
    membershipId: "host-1:host",
    role: "host",
    authEpoch: 1,
    protocolMinimum: 2,
    protocolMaximum: 2,
    sessionExpiresAt: now + 86_400,
    iat: now,
    exp: now + 300,
  };
  return {
    verifyTicket: async () => ({ ...claims, jti: crypto.randomUUID() }),
    verifyResumeToken: async () => claims,
    validateClaims: async () => true,
    issueResumeToken: async () => "resume-host",
    iceServers: () => [],
  };
}
