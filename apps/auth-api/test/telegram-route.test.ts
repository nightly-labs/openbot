import { createHmac } from "node:crypto";
import { isDynamicRecord, isFunction } from "@openbot/contracts/runtime-values";
import { SLACK_ROUTE_AUDIENCE } from "@openbot/contracts/signal-protocol/slack-route";
import {
  TELEGRAM_LINK_CODE_PATTERN,
  TELEGRAM_LINK_CODE_TTL_SECONDS,
  TELEGRAM_ROUTE_AUDIENCE,
  TELEGRAM_ROUTE_CHATS_LIMIT,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/server/crypto";
import { runApiEffect } from "../src/server/effect-runtime";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

// The route files read the Worker bindings from this module, and have no other seam.
const workerEnvironment = vi.hoisted((): { value: object } => ({ value: {} }));
vi.mock("cloudflare:workers", () => ({
  get env() {
    return workerEnvironment.value;
  },
  waitUntil: () => undefined,
}));

const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
const other = { id: "other", email: "other@example.com", name: null, avatarUrl: null };
const BOT_ID = "7000000001";
const WEBHOOK_SECRET = "s".repeat(32);

// The chat link decides which computer gets a chat's messages and can post in it. Only the account
// that linked a chat can move it, a code links one chat once, and a host's route ticket names only
// its own chats.
describe("Telegram chat routes", () => {
  it("links a chat once with a code that only the host asked for", async () => {
    const { controlPlane, database, hosts, clock, revocations } = await setup();
    const unconfigured = await setup({ telegram: false });
    await expect(
      runApiEffect(unconfigured.controlPlane.issueTelegramLinkCode("host-1", unconfigured.hosts["host-1"])),
    ).rejects.toMatchObject({ status: 503, code: "telegram_not_configured" });
    await expect(runApiEffect(controlPlane.issueTelegramLinkCode("host-1", "wrong-token"))).rejects.toMatchObject({
      code: "host_unauthorized",
    });

    const link = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    expect(link).toEqual({
      botUsername: "openbot_bot",
      code: expect.stringMatching(TELEGRAM_LINK_CODE_PATTERN),
      expiresAt: clock.now + TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000,
    });
    // D1 keeps only the hash of the code.
    expect(database.prepare("SELECT code_hash, account_id FROM telegram_link_codes").all()).toEqual([
      { code_hash: await runApiEffect(sha256(link.code)), account_id: "owner" },
    ]);

    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: "7000000002", chatId: "-1001", code: link.code })),
    ).rejects.toMatchObject({ status: 404, code: "telegram_link_invalid" });
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: "x".repeat(43) })),
    ).rejects.toMatchObject({ status: 404, code: "telegram_link_invalid" });
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "chat", code: link.code })),
    ).rejects.toMatchObject({ status: 400 });

    const linkedAt = clock.now;
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: link.code })),
    ).resolves.toEqual({ hostId: "host-1", linkedAt });
    // Signal drops any older route of the chat when the link is made.
    expect(revocations()).toEqual([
      { type: "telegram-route-revoked", botId: BOT_ID, chatId: "-1001", through: linkedAt - 1 },
    ]);

    // Telegram can send `/start <code>` again: the chat it linked gets the same answer.
    clock.now += 1_000;
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: link.code })),
    ).resolves.toEqual({ hostId: "host-1", linkedAt });
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1002", code: link.code })),
    ).rejects.toMatchObject({ code: "telegram_link_invalid" });
    expect(revocations()).toHaveLength(1);

    const expired = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    clock.now += TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000;
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1002", code: expired.code })),
    ).rejects.toMatchObject({ code: "telegram_link_invalid" });
    expect(database.prepare("SELECT chat_id, host_id FROM telegram_chat_routes").all()).toEqual([
      { chat_id: "-1001", host_id: "host-1" },
    ]);
  });

  it("moves a chat between the hosts of one account and refuses another account", async () => {
    const { controlPlane, database, hosts, clock, revocations } = await setup();
    const first = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    await runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: first.code }));

    clock.now += 1_000;
    const moved = await runApiEffect(controlPlane.issueTelegramLinkCode("host-2", hosts["host-2"]));
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: moved.code })),
    ).resolves.toEqual({ hostId: "host-2", linkedAt: clock.now });
    // host-1 cannot keep the chat with the ticket it holds.
    expect(revocations().at(-1)).toEqual({
      type: "telegram-route-revoked",
      botId: BOT_ID,
      chatId: "-1001",
      through: clock.now - 1,
    });

    const taken = await runApiEffect(controlPlane.issueTelegramLinkCode("host-3", hosts["host-3"]));
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: taken.code })),
    ).rejects.toMatchObject({ status: 409, code: "telegram_chat_taken" });
    expect(database.prepare("SELECT host_id, account_id FROM telegram_chat_routes").all()).toEqual([
      { host_id: "host-2", account_id: "owner" },
    ]);
    expect(revocations()).toHaveLength(2);

    // After the first host disconnects the chat, the refused code is still unused and links it.
    await runApiEffect(controlPlane.disconnectTelegramChat("host-2", hosts["host-2"], "-1001"));
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: taken.code })),
    ).resolves.toMatchObject({ hostId: "host-3" });
  });

  it("removes Telegram routes and unused codes with a host, without changing another host", async () => {
    const { controlPlane, hosts, clock } = await setup();
    const first = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    await runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: first.code }));
    const unused = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    const otherLink = await runApiEffect(controlPlane.issueTelegramLinkCode("host-2", hosts["host-2"]));
    await runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1002", code: otherLink.code }));
    const otherUnused = await runApiEffect(controlPlane.issueTelegramLinkCode("host-2", hosts["host-2"]));

    await runApiEffect(controlPlane.removeOwnedHost(owner.id, "host-1"));
    await expect(
      runApiEffect(
        controlPlane.validateTelegramRoute({
          hostId: "host-1",
          chats: [{ id: "-1001", botId: BOT_ID, linkedAt: clock.now }],
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1003", code: unused.code })),
    ).rejects.toMatchObject({ code: "telegram_link_invalid" });
    const replacement = await runApiEffect(controlPlane.issueTelegramLinkCode("host-3", hosts["host-3"]));
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: replacement.code })),
    ).resolves.toMatchObject({ hostId: "host-3" });

    const restored = await runApiEffect(
      controlPlane.registerHost(owner, { hostId: "host-1", name: "Restored host", ownerMembershipId: "host-1:owner" }),
    );
    if (!restored.machineToken) throw new Error("The host credential is missing.");
    await expect(runApiEffect(controlPlane.issueTelegramRoute("host-1", restored.machineToken))).resolves.toMatchObject(
      { chats: [] },
    );
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1003", code: unused.code })),
    ).rejects.toMatchObject({ code: "telegram_link_invalid" });
    await expect(runApiEffect(controlPlane.issueTelegramRoute("host-2", hosts["host-2"]))).resolves.toMatchObject({
      chats: ["-1002"],
    });
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1004", code: otherUnused.code })),
    ).resolves.toMatchObject({ hostId: "host-2" });
  });

  it("limits the chats and the open link codes of a host", async () => {
    const { controlPlane, database, hosts, clock } = await setup();
    const insert = database.prepare(
      "INSERT INTO telegram_chat_routes(bot_id, chat_id, host_id, account_id, linked_at) VALUES (?, ?, 'host-1', 'owner', 1)",
    );
    for (let chat = 1; chat <= TELEGRAM_ROUTE_CHATS_LIMIT; chat += 1) insert.run(BOT_ID, String(chat));
    const code = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "-1001", code: code.code })),
    ).rejects.toMatchObject({ status: 409, code: "telegram_chat_limit" });
    // A chat that the host already has does not count against the limit.
    await expect(
      runApiEffect(controlPlane.linkTelegramChat({ botId: BOT_ID, chatId: "1", code: code.code })),
    ).resolves.toEqual({ hostId: "host-1", linkedAt: 1 });

    for (let count = 1; count < 10; count += 1) {
      await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    }
    await expect(runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]))).rejects.toMatchObject({
      status: 429,
      code: "telegram_link_limit",
    });
    clock.now += TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000;
    await expect(runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]))).resolves.toMatchObject({
      code: expect.any(String),
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM telegram_link_codes").get()).toEqual({ count: 1 });
  });

  it("names only the host's chats in a route ticket that verifies with the public JWKS", async () => {
    const { controlPlane, database, hosts } = await setup();
    database.exec(`
      INSERT INTO telegram_chat_routes(bot_id, chat_id, host_id, account_id, linked_at)
        VALUES ('${BOT_ID}', '-1001', 'host-1', 'owner', 10),
               ('${BOT_ID}', '42', 'host-1', 'owner', 20),
               ('${BOT_ID}', '-1003', 'host-2', 'owner', 30);
      INSERT INTO slack_workspace_routes(team_id, host_id, account_id, app_id, bot_user_id, connected_at)
        VALUES ('T1', 'host-1', 'owner', 'A1', 'U1', 1);
    `);
    await expect(runApiEffect(controlPlane.issueTelegramRoute("host-1", hosts["host-2"]))).rejects.toMatchObject({
      code: "host_unauthorized",
    });
    const route = await runApiEffect(controlPlane.issueTelegramRoute("host-1", hosts["host-1"]));
    expect(route.chats).toEqual(["42", "-1001"]);
    const keys = createLocalJWKSet(controlPlane.publicJwks());
    const verified = await jwtVerify(route.ticket, keys, { audience: TELEGRAM_ROUTE_AUDIENCE });
    expect(verified.payload).toEqual({
      aud: TELEGRAM_ROUTE_AUDIENCE,
      hid: "host-1",
      chats: [
        { id: "42", botId: BOT_ID, linkedAt: 20 },
        { id: "-1001", botId: BOT_ID, linkedAt: 10 },
      ],
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
    await expect(jwtVerify(route.ticket, keys, { audience: SLACK_ROUTE_AUDIENCE })).rejects.toThrow();

    // The Slack ticket uses the same key and keeps its claims in the same order.
    const slack = await runApiEffect(controlPlane.issueSlackRoute("host-1", hosts["host-1"]));
    await expect(jwtVerify(slack.ticket, keys, { audience: SLACK_ROUTE_AUDIENCE })).resolves.toBeTruthy();
    expect(Object.keys(decodeJwt(slack.ticket))).toEqual(["hid", "teams", "iat", "exp", "aud"]);
    expect(decodeJwt(slack.ticket)).toMatchObject({ teams: [{ id: "T1", appId: "A1", linkedAt: 1 }] });

    const unconfigured = await setup({ routeKey: false });
    await expect(
      runApiEffect(unconfigured.controlPlane.issueTelegramRoute("host-1", unconfigured.hosts["host-1"])),
    ).rejects.toMatchObject({ code: "telegram_not_configured" });
  });

  it("keeps only current links when Signal validates a ticket, and disconnects a chat", async () => {
    const { controlPlane, database, hosts, revocations } = await setup();
    database.exec(`
      INSERT INTO telegram_chat_routes(bot_id, chat_id, host_id, account_id, linked_at)
        VALUES ('${BOT_ID}', '-1001', 'host-1', 'owner', 10),
               ('7000000002', '-1001', 'host-1', 'owner', 11),
               ('7000000003', '-1001', 'host-2', 'owner', 12);
    `);
    await expect(
      runApiEffect(
        controlPlane.validateTelegramRoute({
          hostId: "host-1",
          chats: [
            { id: "-1001", botId: BOT_ID, linkedAt: 10 },
            { id: "-1001", botId: BOT_ID, linkedAt: 9 },
            { id: "-1001", botId: "7000000003", linkedAt: 12 },
            { id: "-1002", botId: BOT_ID, linkedAt: 10 },
          ],
        }),
      ),
    ).resolves.toEqual([{ id: "-1001", botId: BOT_ID, linkedAt: 10 }]);

    await expect(
      runApiEffect(controlPlane.disconnectTelegramChat("host-1", hosts["host-1"], "not-a-chat")),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      runApiEffect(controlPlane.disconnectTelegramChat("host-1", hosts["host-2"], "-1001")),
    ).rejects.toMatchObject({ code: "host_unauthorized" });
    await runApiEffect(controlPlane.disconnectTelegramChat("host-1", hosts["host-1"], "-1001"));
    // Each bot's route of the chat on this host goes, and Signal drops it now. Another host keeps its own.
    expect(database.prepare("SELECT bot_id, host_id FROM telegram_chat_routes").all()).toEqual([
      { bot_id: "7000000003", host_id: "host-2" },
    ]);
    expect(revocations()).toEqual(
      expect.arrayContaining([
        { type: "telegram-route-revoked", botId: BOT_ID, chatId: "-1001", through: expect.any(Number) },
        { type: "telegram-route-revoked", botId: "7000000002", chatId: "-1001", through: expect.any(Number) },
      ]),
    );
    expect(revocations()).toHaveLength(2);
    await expect(
      runApiEffect(
        controlPlane.validateTelegramRoute({ hostId: "host-1", chats: [{ id: "-1001", botId: BOT_ID, linkedAt: 10 }] }),
      ),
    ).resolves.toEqual([]);
    await runApiEffect(controlPlane.disconnectTelegramChat("host-1", hosts["host-1"], "-1001"));
    expect(revocations()).toHaveLength(2);
  });

  it("answers the Signal routes only for a signed request", async () => {
    const { bindings, hosts, controlPlane } = await setup();
    // No webhook URL: the route's own control plane must not send events to the network.
    workerEnvironment.value = { ...bindings, ...fakeWorkerResources(), REMOTE_AUTH_WEBHOOK_URL: undefined };
    const { Route: LinkRoute } = await import("../src/routes/v2/remote/telegram-route/link");
    const { Route: ValidateRoute } = await import("../src/routes/v2/remote/telegram-route/validate");
    const link = await runApiEffect(controlPlane.issueTelegramLinkCode("host-1", hosts["host-1"]));
    const linkBody = JSON.stringify({ botId: BOT_ID, chatId: "-1001", code: link.code });
    const validateBody = JSON.stringify({ hostId: "host-1", chats: [] });
    const post = (handlers: unknown, body: string, headers: Record<string, string>) => {
      if (!hasPostHandler(handlers)) throw new Error("The route has no POST handler.");
      return handlers.POST({
        request: new Request("https://openbot.run/v2/remote/telegram-route", { method: "POST", body, headers }),
        params: {},
      });
    };

    for (const [route, body] of [
      [LinkRoute, linkBody],
      [ValidateRoute, validateBody],
    ] as const) {
      const unsigned = await post(route.options.server?.handlers, body, {});
      expect(unsigned.status).toBe(401);
      const forged = await post(route.options.server?.handlers, body, signature(body, "f".repeat(32)));
      expect(forged.status).toBe(401);
    }
    expect(bindings.database.prepare("SELECT COUNT(*) AS count FROM telegram_chat_routes").get()).toEqual({
      count: 0,
    });

    const linked = await post(LinkRoute.options.server?.handlers, linkBody, signature(linkBody, WEBHOOK_SECRET));
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({ hostId: "host-1" });

    // A route wake starts a server, so only Signal can ask for it, and only for a linked route.
    const { Route: WakeRoute } = await import("../src/routes/v2/remote/route-wake");
    const wake = (chatId: string) =>
      JSON.stringify({ route: { platform: "telegram", botId: BOT_ID, chatId }, wake: true });
    expect((await post(WakeRoute.options.server?.handlers, wake("-1001"), {})).status).toBe(401);
    const known = await post(
      WakeRoute.options.server?.handlers,
      wake("-1001"),
      signature(wake("-1001"), WEBHOOK_SECRET),
    );
    await expect(known.json()).resolves.toEqual({ hostId: "host-1", state: "not_hosted" });
    const unknown = await post(
      WakeRoute.options.server?.handlers,
      wake("-1002"),
      signature(wake("-1002"), WEBHOOK_SECRET),
    );
    await expect(unknown.json()).resolves.toEqual({ hostId: null, state: "not_hosted" });
  });
});

function hasPostHandler(
  value: unknown,
): value is { POST: (input: { request: Request; params: object }) => Promise<Response> } {
  return isDynamicRecord(value) && isFunction(value.POST);
}

function signature(body: string, secret: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  return {
    "OpenBot-Timestamp": timestamp,
    "OpenBot-Signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url"),
  };
}

/** The other bindings that `requireWorkerBindings` checks. The Telegram routes do not use them. */
function fakeWorkerResources() {
  const bucket = { get: () => null, put: () => null, delete: () => null };
  const limiter = { limit: async () => ({ success: true }) };
  return {
    AVATARS: bucket,
    SKILLS: bucket,
    SITES: bucket,
    MARKETPLACE_INGRESS_RATE_LIMITER: limiter,
    MARKETPLACE_MUTATION_RATE_LIMITER: limiter,
    MARKETPLACE_UPLOAD_RATE_LIMITER: limiter,
    SITE_REPORT_RATE_LIMITER: limiter,
    GITHUB_TOKEN_RATE_LIMITER: limiter,
  };
}

async function setup(options: { telegram?: boolean; routeKey?: boolean } = {}) {
  const database = migratedDatabase();
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1),
             ('other', 'email:other@example.com', 'other@example.com', 1, 1);
  `);
  const pair = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: "test-key", alg: "ES256" });
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
  const webhookBodies: string[] = [];
  const clock = { now: Date.now() };
  const bindings = {
    DB: sqliteD1(database),
    database,
    REMOTE_TICKET_PRIVATE_JWK: privateJwk,
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
    REMOTE_TICKET_KEY_ID: "test-key",
    REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
    REMOTE_AUTH_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...(options.routeKey === false ? {} : { SLACK_ROUTE_PRIVATE_JWK: privateJwk, SLACK_ROUTE_KEY_ID: "test-key" }),
    ...(options.telegram === false ? {} : { TELEGRAM_BOT_ID: BOT_ID, TELEGRAM_BOT_USERNAME: "openbot_bot" }),
  };
  const controlPlane = new RemoteControlPlane(bindings, {
    now: () => clock.now,
    fetch: async (_input, init) => {
      webhookBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204 });
    },
  });
  const register = async (hostId: string, user: typeof owner) => {
    const registration = await runApiEffect(
      controlPlane.registerHost(user, { hostId, name: hostId, ownerMembershipId: `${hostId}:owner` }),
    );
    if (!registration.machineToken) throw new Error("The host credential is missing.");
    return registration.machineToken;
  };
  const hosts = {
    "host-1": await register("host-1", owner),
    "host-2": await register("host-2", owner),
    "host-3": await register("host-3", other),
  };
  const revocations = () =>
    webhookBodies.map((body) => JSON.parse(body)).filter((event) => event.type === "telegram-route-revoked");
  return { controlPlane, database, bindings, hosts, clock, revocations };
}
