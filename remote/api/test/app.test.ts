import { createHmac, generateKeyPairSync } from "node:crypto";
import { Effect } from "effect";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp, signalClientIp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import { type DiscordRestRequest, DiscordTransportError, makeDiscordApi } from "../src/discord-api";
import { DiscordState } from "../src/discord-events";
import type { RemoteTicketClaims } from "../src/protocol";
import { type RemoteTokenProvider, SignalService } from "../src/signal-service";
import { RemoteTokenError, RemoteTokenService, signServiceRequest } from "../src/tokens";
import { runSignal, signalRuntime } from "./signal-runtime";

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
    const app = createRemoteApiApp(config, signal, signalRuntime(signal));
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
    const app = createRemoteApiApp(config, signal, signalRuntime(signal));
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
  const developmentSecret = "d".repeat(32);

  it("checks Slack's signature and passes the request to the workspace's host", async () => {
    const { app, signal, route } = await slackRoute(signingSecret);
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev1","event":{"type":"app_mention"}}';

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
      await runSignal(
        signal,
        signal.receive(socket, JSON.stringify({ type: "hello", version: 1, peer: "ingress", token: "t", slackRoute })),
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
    await runSignal(
      signal,
      signal.receive(
        ingress,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }),
        }),
      ),
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
    await runSignal(
      signal,
      signal.receive(
        other,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: [] }),
        }),
      ),
    );
    const answer = { type: "slack-delivery-result", version: 1, requestId: delivery.requestId, status: 200 };
    await runSignal(signal, signal.receive(other, JSON.stringify(answer)));
    expect(other.messages.at(-1)).toContain('"code":"permission_denied"');

    await runSignal(signal, signal.receive(ingress, JSON.stringify(answer)));
    expect((await pending).status).toBe(200);

    // A button press carries the workspace inside the form's `payload`.
    const press = `payload=${encodeURIComponent('{"type":"block_actions","api_app_id":"APROD","team":{"id":"T1"}}')}`;
    const pressed = post(app, press, { contentType: "application/x-www-form-urlencoded" });
    await vi.waitFor(() => expect(ingress.messages).toHaveLength(2));
    expect(JSON.parse(ingress.messages[1] ?? "{}")).toMatchObject({ teamId: "T1", kind: "interactivity" });
    await runSignal(signal, signal.disconnect(ingress));
    expect((await pressed).status).toBe(503);
  });

  it("keeps a workspace with its newest link, and drops a revoked one", async () => {
    const { app, signal, route, revoke } = await slackRoute(signingSecret);
    const connect = async (id: string, linkedAt: number) => {
      const socket = testSocket(id);
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
            slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, linkedAt),
          }),
        ),
      );
      expect(socket.messages.at(-1)).toContain('"type":"ready"');
      socket.messages.length = 0;
      return socket;
    };
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev2","event":{"type":"app_mention"}}';
    const delivered = async (socket: TestSocket) => {
      const pending = post(app, body);
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await runSignal(
        signal,
        signal.receive(socket, JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 })),
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

  it("after a start, takes only the links that the account service confirms", async () => {
    // Signal restarted, so it lost the revocations it held. D1 links T1 to this host with the
    // newer link only.
    let available = true;
    const { app, signal, route } = await slackRoute(signingSecret, (_hostId, teams) =>
      Effect.gen(function* () {
        if (!available) return yield* new RemoteTokenError({ message: "offline" });
        return teams.filter((team) => team.linkedAt === 2_000).map((team) => team.id);
      }),
    );
    const hello = async (linkedAt: number) => {
      const socket = testSocket(crypto.randomUUID());
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
            slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, linkedAt),
          }),
        ),
      );
      return socket;
    };
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev3","event":{"type":"app_mention"}}';

    // The ticket of a host that lost the workspace before the restart.
    expect((await hello(1_000)).messages.at(-1)).toContain('"type":"ready"');
    expect((await post(app, body)).status).toBe(503);

    // Without an answer from the account service, the socket does not connect, and tries again.
    available = false;
    expect((await hello(2_000)).messages.at(-1)).toContain('"code":"authentication_required"');
    expect((await post(app, body)).status).toBe(503);

    available = true;
    const current = await hello(2_000);
    const pending = post(app, body);
    await vi.waitFor(() => expect(current.messages).toHaveLength(2));
    const { requestId } = JSON.parse(current.messages[1] ?? "{}");
    await runSignal(
      signal,
      signal.receive(current, JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 })),
    );
    expect((await pending).status).toBe(200);
  });

  it("keeps each app's route of a workspace apart, and binds each secret to its app", async () => {
    // The production and development apps are both installed in T1, each linked to its own host.
    const { app, signal, route } = await slackRoute(signingSecret);
    const connect = async (id: string, appId: string) => {
      const socket = testSocket(id);
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
            slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, 1_000, appId),
          }),
        ),
      );
      socket.messages.length = 0;
      return socket;
    };
    const production = await connect("production", "APROD");
    const development = await connect("development", "ADEV");
    const event = (appId: string) =>
      `{"type":"event_callback","api_app_id":"${appId}","team_id":"T1","event_id":"Ev4","event":{"type":"app_mention"}}`;

    // The development app's secret cannot send a request in the production app's name.
    expect((await post(app, event("APROD"), { secret: developmentSecret })).status).toBe(401);
    expect(production.messages).toHaveLength(0);

    const answer = async (socket: TestSocket, pending: Promise<Response>) => {
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await runSignal(
        signal,
        signal.receive(socket, JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 })),
      );
      expect((await pending).status).toBe(200);
    };
    await answer(development, post(app, event("ADEV"), { secret: developmentSecret }));
    expect(production.messages).toHaveLength(0);
    await answer(production, post(app, event("APROD")));
    expect(development.messages).toHaveLength(0);
  });

  it("turns the Slack route off for a signing secret without its app", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      readRemoteApiConfig({
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "localhost",
        SLACK_SIGNING_SECRET: signingSecret,
      }).slackSigningSecrets,
    ).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("answers 503 when the signing secret is not configured", async () => {
    const { app } = await slackRoute(null);
    expect((await post(app, '{"type":"url_verification","challenge":"abc"}')).status).toBe(503);
  });

  function post(
    app: ReturnType<typeof createRemoteApiApp>,
    body: string,
    options: {
      contentType?: string;
      timestamp?: string;
      signature?: string;
      signedBody?: string;
      secret?: string;
    } = {},
  ) {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1_000));
    const signature =
      options.signature ??
      `v0=${createHmac("sha256", options.secret ?? signingSecret)
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

// A host acts in Discord with the bot's token through Signal, so each refusal here keeps one host
// out of another host's guilds.
describe("Discord route", () => {
  it("refuses a Discord route ticket of another host", async () => {
    const { signal, route } = await discordRoute();
    const socket = testSocket("ingress");
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
          discordRoute: await route({ hid: "host-2", guilds: ["100"] }),
        }),
      ),
    );
    expect(socket.messages.at(-1)).toContain('"code":"authentication_required"');
    expect(signal.deliverDiscord("100", { kind: "removed" })).toBe(false);
  });

  it("lets a host act only in its own guilds and their channels", async () => {
    const { app, connect, call, discordCalls } = await discordRoute();
    const first = await connect("first", ["100"]);
    const second = await connect("second", ["200"]);
    const message = { op: "createMessage", content: "Hello", replyTo: null, buttons: [] };

    const created = await call(first.token, { ...message, guildId: "100", channelId: "110" });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ messageId: "999" });
    expect(discordCalls.at(-1)).toMatchObject({
      method: "POST",
      route: "/channels/110/messages",
      body: { allowed_mentions: { parse: [], replied_user: false } },
    });
    const sent = discordCalls.length;

    // Another host's guild, a channel of another guild, a missing or unknown token.
    const otherGuild = await call(first.token, { ...message, guildId: "200", channelId: "210" });
    expect(otherGuild.status).toBe(403);
    expect(await otherGuild.json()).toEqual({ error: { code: "unknown_guild" } });
    const otherChannel = await call(first.token, { ...message, guildId: "100", channelId: "210" });
    expect(otherChannel.status).toBe(403);
    expect(await otherChannel.json()).toEqual({ error: { code: "forbidden" } });
    expect((await call(second.token, { op: "member", guildId: "100", userId: "1" })).status).toBe(403);
    expect((await call(null, { ...message, guildId: "100", channelId: "110" })).status).toBe(401);
    expect((await call("x".repeat(43), { ...message, guildId: "100", channelId: "110" })).status).toBe(401);
    expect(discordCalls.slice(sent).filter((request) => request.method !== "GET")).toEqual([]);

    // The session ends with its socket.
    await runSignal(app.signal, app.signal.disconnect(first.socket));
    expect((await call(first.token, { ...message, guildId: "100", channelId: "110" })).status).toBe(401);
  });

  it("stops deliveries and calls for a revoked guild", async () => {
    const { connect, call, revoke, signal } = await discordRoute();
    const host = await connect("host", ["100"]);
    expect(signal.deliverDiscord("100", { kind: "removed" })).toBe(true);
    expect(JSON.parse(host.socket.messages.at(-1) ?? "{}")).toEqual({
      type: "discord-delivery",
      version: 1,
      guildId: "100",
      delivery: { kind: "removed" },
    });

    await revoke("100", 1_000);
    const count = host.socket.messages.length;
    expect(signal.deliverDiscord("100", { kind: "removed" })).toBe(false);
    expect(host.socket.messages).toHaveLength(count);
    const refused = await call(host.token, { op: "channel", guildId: "100", channelId: "110" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: "unknown_guild" } });
  });
});

async function discordRoute() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "discord-route-1";
  jwk.alg = "ES256";
  const config = readRemoteApiConfig({
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [jwk] }),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    REMOTE_SESSION_SECRET: "s".repeat(32),
    REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
    TURN_SHARED_SECRET: "t".repeat(32),
    TURN_HOST: "localhost",
    DISCORD_BOT_TOKEN: "bot.token.value",
    DISCORD_APPLICATION_ID: "12345678901234567",
  });
  const routes = new RemoteTokenService(config);
  const signal = new SignalService(
    {
      ...hostTickets(),
      verifyDiscordRoute: (token, hostId) => routes.verifyDiscordRoute(token, hostId),
      validateDiscordRoute: (_hostId, guilds) => Effect.succeed(guilds.map((guild) => guild.id)),
    },
    8,
    undefined,
    undefined,
    undefined,
    { discord: true },
  );
  // Discord itself: channels 110 and 210 are in guilds 100 and 200.
  const discordCalls: DiscordRestRequest[] = [];
  const channelGuilds = new Map([
    ["110", "100"],
    ["210", "200"],
  ]);
  const api = makeDiscordApi(
    {
      request: (input) =>
        Effect.gen(function* () {
          discordCalls.push(input);
          const channelId = /^\/channels\/([0-9]+)$/u.exec(input.route)?.[1];
          if (input.method === "GET" && channelId) {
            const guildId = channelGuilds.get(channelId);
            if (!guildId) return yield* new DiscordTransportError({ status: 404 });
            return { id: channelId, guild_id: guildId, name: `channel-${channelId}` };
          }
          if (input.method === "GET") return { nick: null, user: { id: "1", username: "user" } };
          return { id: "999" };
        }),
    },
    new DiscordState("12345678901234567"),
  );
  const app = Object.assign(createRemoteApiApp(config, signal, signalRuntime(signal), api), { signal });
  const now = Math.floor(Date.now() / 1_000);
  const route = (claims: { hid: string; guilds: string[] }, linkedAt = 1_000) =>
    new SignJWT({ hid: claims.hid, guilds: claims.guilds.map((id) => ({ id, linkedAt })) })
      .setProtectedHeader({ alg: "ES256", kid: "discord-route-1" })
      .setAudience("openbot-discord-route")
      .setIssuedAt(now - 120)
      .setExpirationTime(now + 3_600)
      .sign(privateKey);
  const connect = async (id: string, guilds: string[]) => {
    const socket = testSocket(id);
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
          discordRoute: await route({ hid: "host-1", guilds }),
        }),
      ),
    );
    const session = JSON.parse(socket.messages.at(-1) ?? "{}");
    expect(session).toMatchObject({ type: "discord-session", token: expect.any(String) });
    return { socket, token: String(session.token) };
  };
  const call = (token: string | null, body: unknown) =>
    app.handle(
      new Request("http://localhost/v1/discord/api", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const revoke = async (guildId: string, through: number) => {
    const body = JSON.stringify({ type: "discord-route-revoked", guildId, through });
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
  return { app, signal, route, connect, call, revoke, discordCalls };
}

async function slackRoute(
  signingSecret: string | null,
  // What D1 answers while Signal starts: by default, every link is current.
  validateSlackRoute: RemoteTokenProvider["validateSlackRoute"] = (_hostId, teams) =>
    Effect.succeed(teams.map((team) => team.id)),
) {
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
    ...(signingSecret ? { SLACK_SIGNING_SECRET: `ADEV:${"d".repeat(32)}, APROD:${signingSecret}` } : {}),
  });
  const routes = new RemoteTokenService(config);
  const signal = new SignalService(
    {
      ...hostTickets(),
      verifySlackRoute: (token, hostId) => routes.verifySlackRoute(token, hostId),
      validateSlackRoute,
    },
    8,
  );
  const now = Math.floor(Date.now() / 1_000);
  const route = (
    claims: { hid: string; teams: string[] },
    lifetimeSeconds = 3_600,
    linkedAt = 1_000,
    appId = "APROD",
  ) =>
    new SignJWT({ hid: claims.hid, teams: claims.teams.map((id) => ({ id, appId, linkedAt })) })
      .setProtectedHeader({ alg: "ES256", kid: "slack-route-1" })
      .setAudience("openbot-slack-route")
      .setIssuedAt(now - 120)
      .setExpirationTime(now + lifetimeSeconds)
      .sign(privateKey);
  const app = createRemoteApiApp(config, signal, signalRuntime(signal));
  // What the account service sends when it unlinks or moves a workspace.
  const revoke = async (teamId: string, through: number) => {
    const body = JSON.stringify({ type: "slack-route-revoked", appId: "APROD", teamId, through });
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
    verifyTicket: () => Effect.sync(() => ({ ...claims, jti: crypto.randomUUID() })),
    verifyResumeToken: () => Effect.succeed(claims),
    validateClaims: () => Effect.succeed(true),
    issueResumeToken: () => Effect.succeed("resume-host"),
    iceServers: () => [],
  };
}
