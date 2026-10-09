import { generateKeyPairSync } from "node:crypto";
import {
  createIngressQueueKeyPair,
  importIngressQueuePrivateKey,
  openQueuedDelivery,
} from "@openbot/contracts/signal-protocol/ingress-queue";
import type { TelegramCallMethod, TelegramCallParams } from "@openbot/contracts/signal-protocol/telegram-route";
import { Effect } from "effect";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import type { RouteWaker } from "../src/ingress-queue";
import type { RemoteTicketClaims } from "../src/protocol";
import { type RemoteTokenProvider, SignalService } from "../src/signal-service";
import { TelegramBotApi, type TelegramFetch } from "../src/telegram";
import { RemoteTokenService, signServiceRequest, TelegramFileTokens, telegramWebhookSecret } from "../src/tokens";
import { runSignal, signalRuntime } from "./signal-runtime";

const BOT_ID = "777000111";
const BOT_TOKEN = `${BOT_ID}:AAH-bot_token_secret_part`;
const LINK_CODE = "c".repeat(40);

// Telegram posts to Signal from the internet, and a host calls the Bot API through Signal with a
// token that only Signal has. Each refusal here is a security check: nothing reaches a host unless
// it has the bot's secret header, and a host acts only in the chats routed to its own socket.
describe("Telegram route", () => {
  it("checks the secret header and passes a routed chat's update as it is", async () => {
    const { connect, postUpdate } = await telegramRoute();
    const body = JSON.stringify({ update_id: 1, message: { message_id: 5, chat: { id: -100 }, text: "private text" } });

    expect((await postUpdate(body, { secret: "x".repeat(43) })).status).toBe(401);
    expect((await postUpdate(body, { secret: "" })).status).toBe(401);
    expect((await postUpdate(body, { botId: "999" })).status).toBe(404);

    const ingress = await connect("ingress", [{ id: "-100" }]);
    expect(JSON.parse(ingress.ready).capabilities).toEqual(["telegram"]);

    expect((await postUpdate(body)).status).toBe(200);
    expect(ingress.messages).toHaveLength(1);
    const delivery = JSON.parse(ingress.messages[0] ?? "{}");
    expect(delivery).toMatchObject({ type: "telegram-delivery", botId: BOT_ID, chatId: "-100" });
    expect(Buffer.from(delivery.bodyBase64, "base64").toString()).toBe(body);

    // An unrouted chat and a too large update are dropped, and Telegram still gets 200.
    expect((await postUpdate(body.replace("-100", "-200"))).status).toBe(200);
    const large = JSON.stringify({ message: { chat: { id: -100 }, text: "x".repeat(64 * 1024) } });
    expect((await postUpdate(large)).status).toBe(200);
    expect(ingress.messages).toHaveLength(1);
  });

  it("refuses calls outside the socket's chats, methods and parameters", async () => {
    const { connect, postUpdate, call, requests } = await telegramRoute();
    const first = await connect("first", [{ id: "-100" }]);
    const second = await connect("second", [{ id: "-200" }]);

    // Another socket's chat, or a bot that Signal does not have, makes no Bot API request.
    expect(await call(second, "sendMessage", { chat_id: -100, text: "hi" })).toMatchObject({
      ok: false,
      errorCode: 403,
      description: "forbidden",
    });
    expect(await call(second, "getMe", {}, "123")).toMatchObject({ ok: false, errorCode: 403 });

    // A method or a parameter outside the allowlist fails the whole frame.
    const refused = async (
      method: string,
      params: TelegramCallParams["sendMessage"] & { reply_parameters?: { chat_id?: number } },
    ) => {
      const socket = await connect(crypto.randomUUID(), [{ id: "-200" }]);
      const frame = { type: "telegram-call", version: 1, requestId: "r1", botId: BOT_ID, method, params };
      await runSignal(socket.signal, socket.signal.receive(socket, JSON.stringify(frame)));
      return socket.messages.at(-1) ?? "";
    };
    expect(await refused("sendSticker", { chat_id: -200, text: "hi" })).toContain('"code":"invalid_message"');
    expect(
      await refused("sendMessage", { chat_id: -200, text: "hi", reply_parameters: { message_id: 1, chat_id: -100 } }),
    ).toContain('"code":"invalid_message"');

    // A callback query can be answered only by the socket that received it.
    expect(await call(first, "answerCallbackQuery", { callback_query_id: "cb-1" })).toMatchObject({
      ok: false,
      errorCode: 403,
    });
    await postUpdate(JSON.stringify({ callback_query: { id: "cb-1", message: { chat: { id: -100 } } } }));
    expect(first.messages.at(-1)).toContain('"type":"telegram-delivery"');
    expect(await call(second, "answerCallbackQuery", { callback_query_id: "cb-1" })).toMatchObject({
      ok: false,
      errorCode: 403,
    });
    expect(requests).toHaveLength(0);
    expect(await call(first, "answerCallbackQuery", { callback_query_id: "cb-1" })).toEqual({
      type: "telegram-call-result",
      version: 1,
      requestId: expect.any(String),
      ok: true,
      result: {},
    });
    expect(requests.map((request) => request.method)).toEqual(["answerCallbackQuery"]);
  });

  it("keeps a chat with its newest link, and drops a revoked one", async () => {
    const { connect, postUpdate, revoke } = await telegramRoute();
    const body = JSON.stringify({ message: { chat: { id: -100 }, text: "hi" } });
    const delivered = async (socket: TestSocket) => {
      const before = socket.messages.length;
      await postUpdate(body);
      return socket.messages.length === before + 1;
    };

    // The chat moved to a new link. The socket with the older ticket connects after it.
    const current = await connect("current", [{ id: "-100", linkedAt: 2_000 }]);
    const stale = await connect("stale", [{ id: "-100", linkedAt: 1_000 }]);
    expect(await delivered(current)).toBe(true);
    expect(stale.messages).toHaveLength(0);

    // Unlinked: the route goes at once, and the last ticket cannot bring it back.
    await revoke("-100", 2_500);
    expect(await delivered(current)).toBe(false);
    const replay = await connect("replay", [{ id: "-100", linkedAt: 2_000 }]);
    expect(await delivered(replay)).toBe(false);

    const relinked = await connect("relinked", [{ id: "-100", linkedAt: 3_000 }]);
    await revoke("-100", 2_999);
    expect(await delivered(relinked)).toBe(true);
  });

  it("starts a sleeping hosted server and gives it the kept updates sealed, in order", async () => {
    const wakes: boolean[] = [];
    const { connect, postUpdate, call, signal } = await telegramRoute({}, (route, wake) => {
      wakes.push(wake);
      return Effect.succeed(
        route.platform === "telegram" && route.chatId === "-100"
          ? { hostId: "host-1", state: "starting" as const }
          : { hostId: null, state: "not_hosted" as const },
      );
    });
    const key = await createIngressQueueKeyPair();
    // The host said hello with its queue key, then its server stopped.
    const before = await connect("before", [{ id: "-100" }], key.publicKey);
    await runSignal(signal, signal.disconnect(before));

    const message = JSON.stringify({ message: { chat: { id: -100 }, text: "private text" } });
    const press = JSON.stringify({ callback_query: { id: "cb-9", message: { chat: { id: -100 } } } });
    const member = JSON.stringify({ my_chat_member: { chat: { id: -100 } } });
    for (const body of [message, press, member]) expect((await postUpdate(body)).status).toBe(200);
    await vi.waitFor(() => expect(signal.metrics().queuedDeliveries).toBe(2));
    // One wake for the route: the next updates use the answer of the first.
    expect(wakes).toEqual([true]);
    await postUpdate(JSON.stringify({ message: { chat: { id: -200 }, text: "other host" } }));

    const after = await connect("after", [{ id: "-100" }], key.publicKey);
    const queued = after.messages.map((frame) => JSON.parse(frame));
    expect(queued.map((frame) => frame.type)).toEqual(["queued-delivery", "queued-delivery"]);
    expect(after.messages.join("")).not.toContain("private text");
    const privateKey = await importIngressQueuePrivateKey(key.privateKey);
    const opened = await Promise.all(queued.map((frame) => openQueuedDelivery(privateKey, "host-1", frame.sealed)));
    expect(
      opened.map((frame) =>
        frame.type === "telegram-delivery" ? Buffer.from(frame.bodyBase64, "base64").toString() : null,
      ),
    ).toEqual([message, press]);
    // The new socket can answer the button press that came while the server slept.
    expect(await call(after, "answerCallbackQuery", { callback_query_id: "cb-9" })).toMatchObject({ ok: true });
    // Sent once.
    const again = await connect("again", [{ id: "-100" }], key.publicKey);
    expect(again.messages).toEqual([]);
  });

  it("links a chat with a /start code and routes it to the host at once", async () => {
    const links: string[][] = [];
    const { connect, postUpdate } = await telegramRoute({
      linkTelegramChat: (botId, chatId, code) => {
        links.push([botId, chatId, code]);
        return Effect.succeed(code === LINK_CODE ? { hostId: "host-1", linkedAt: Date.now() } : null);
      },
    });
    // A hello without a Telegram route is valid, with no chat.
    const ingress = await connect("ingress", null);
    const start = JSON.stringify({ message: { chat: { id: -300 }, text: `/start@openbot_bot ${LINK_CODE}` } });
    expect((await postUpdate(start)).status).toBe(200);
    expect(links).toEqual([[BOT_ID, "-300", LINK_CODE]]);
    expect(Buffer.from(JSON.parse(ingress.messages.at(-1) ?? "{}").bodyBase64, "base64").toString()).toBe(start);
    // Only the update that the account service linked says so: the host links a chat only on it.
    expect(JSON.parse(ingress.messages.at(-1) ?? "{}").linked).toBe(true);
    await postUpdate(JSON.stringify({ message: { chat: { id: -300 }, text: "next" } }));
    expect(ingress.messages).toHaveLength(2);
    expect(JSON.parse(ingress.messages.at(-1) ?? "{}").linked).toBeUndefined();

    // A made-up code in a routed chat reaches the host, but not as a link.
    await postUpdate(JSON.stringify({ message: { chat: { id: -300 }, text: `/start ${"e".repeat(40)}` } }));
    expect(ingress.messages).toHaveLength(3);
    expect(JSON.parse(ingress.messages.at(-1) ?? "{}").linked).toBeUndefined();

    // A code that links nothing routes nothing.
    await postUpdate(JSON.stringify({ message: { chat: { id: -400 }, text: `/start ${"d".repeat(40)}` } }));
    expect(ingress.messages).toHaveLength(3);
  });

  it("keeps from a ticket only the links that the account service confirms whole", async () => {
    // The account service still links the chat, but with another link time: a revoked link must not
    // come back on its chat ID alone.
    const { connect, postUpdate } = await telegramRoute({
      validateTelegramRoute: (_hostId, chats) =>
        Effect.succeed(chats.map((chat) => ({ ...chat, linkedAt: chat.linkedAt + 1 }))),
    });
    const ingress = await connect("ingress", [{ id: "-500", linkedAt: 1_000 }]);
    await postUpdate(JSON.stringify({ message: { chat: { id: -500 }, text: "hi" } }));
    expect(ingress.messages).toHaveLength(0);
  });

  it("signs file and upload tokens, and an upload token works once", async () => {
    const { app, connect, call, requests, sockets } = await telegramRoute();
    const ingress = await connect("ingress", [{ id: "-100" }]);

    // Only the reduced result reaches the host, never the Bot API's whole answer.
    expect((await call(ingress, "getMe", {})).result).toEqual({ botId: BOT_ID, username: "openbot_bot" });
    expect((await call(ingress, "sendMessage", { chat_id: -100, text: "hi" })).result).toEqual({ messageId: 42 });

    const file = await call(ingress, "getFile", { chat_id: -100, file_id: "file-1" });
    expect(Object.keys(file.result)).toEqual(["fileToken", "fileSize"]);
    expect(requests.at(-1)?.body).toEqual({ file_id: "file-1" });
    const download = await app.handle(new Request(`http://localhost/v1/telegram/files/${file.result.fileToken}`));
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(await download.text()).toBe("file bytes");
    const tampered = `${file.result.fileToken.slice(0, 10)}x${file.result.fileToken.slice(11)}`;
    expect((await app.handle(new Request(`http://localhost/v1/telegram/files/${tampered}`))).status).toBe(404);

    const document = await call(ingress, "sendDocument", { chat_id: -100, file_name: "notes.txt" });
    expect(Object.keys(document.result)).toEqual(["uploadToken"]);
    const upload = () =>
      app.handle(
        new Request(`http://localhost/v1/telegram/uploads/${document.result.uploadToken}`, {
          method: "POST",
          body: "document bytes",
        }),
      );
    const uploaded = await upload();
    expect(await uploaded.json()).toEqual({ ok: true, messageId: 43 });
    const form = requests.at(-1)?.form;
    expect(form?.get("chat_id")).toBe("-100");
    const sent = form?.get("document");
    expect(sent instanceof File ? [sent.name, await sent.text()] : null).toEqual(["notes.txt", "document bytes"]);
    expect((await upload()).status).toBe(404);

    // The token is in no frame that Signal sent.
    for (const socket of sockets.values()) {
      for (const message of socket.messages) expect(message).not.toContain("bot_token_secret_part");
    }
  });

  it("refuses a tampered, expired or reused token", () => {
    const tokens = new TelegramFileTokens("s".repeat(32));
    const now = 1_000_000;
    const file = tokens.issueFile({ botId: BOT_ID, filePath: "documents/file_1.pdf" }, now);
    expect(tokens.verifyFile(file, now + 1)).toEqual({ botId: BOT_ID, filePath: "documents/file_1.pdf" });
    expect(tokens.verifyFile(file, now + 120)).toBeNull();
    const [payload, signature] = file.split(".");
    const forged = Buffer.from(JSON.stringify({ botId: BOT_ID, filePath: "other", exp: now + 60 })).toString(
      "base64url",
    );
    expect(tokens.verifyFile(`${forged}.${signature}`, now)).toBeNull();
    expect(tokens.verifyFile(`${payload}.${signature}x`, now)).toBeNull();
    expect(new TelegramFileTokens("o".repeat(32)).verifyFile(file, now)).toBeNull();

    const upload = tokens.issueUpload({ botId: BOT_ID, chatId: -100, fileName: "a.txt" }, now);
    // A file token is not an upload token.
    expect(tokens.consumeUpload(file, now)).toBeNull();
    expect(tokens.consumeUpload(upload, now + 120)).toBeNull();
    expect(tokens.consumeUpload(upload, now)).toEqual({ botId: BOT_ID, chatId: -100, fileName: "a.txt" });
    expect(tokens.consumeUpload(upload, now)).toBeNull();
  });
});

interface TestSocket {
  id: string;
  ip: string;
  messages: string[];
  ready: string;
  signal: SignalService;
  send(message: string): void;
  close(): void;
}

async function telegramRoute(provider: Partial<RemoteTokenProvider> = {}, routeWaker: RouteWaker | null = null) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "route-1";
  jwk.alg = "ES256";
  const config = readRemoteApiConfig({
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [jwk] }),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    REMOTE_SESSION_SECRET: "s".repeat(32),
    REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
    TURN_SHARED_SECRET: "t".repeat(32),
    TURN_HOST: "localhost",
    TELEGRAM_BOT_TOKENS: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: "h".repeat(32),
  });
  if (!config.telegram) throw new Error("Telegram is not configured.");
  const requests: Array<{ method: string; body?: unknown; form?: FormData }> = [];
  const fetch: TelegramFetch = async (url, init) => {
    if (url === `https://telegram.test/file/bot${BOT_TOKEN}/documents/file_1.pdf`) return new Response("file bytes");
    const method = url.slice(`https://telegram.test/bot${BOT_TOKEN}/`.length);
    requests.push(
      init.body instanceof FormData ? { method, form: init.body } : { method, body: JSON.parse(String(init.body)) },
    );
    const results = new Map(
      Object.entries({
        getMe: { id: Number(BOT_ID), is_bot: true, first_name: "OpenBot", username: "openbot_bot" },
        sendMessage: { message_id: 42, chat: { id: -100 }, text: "private text" },
        getFile: { file_id: "file-1", file_unique_id: "u", file_size: 10, file_path: "documents/file_1.pdf" },
        sendDocument: { message_id: 43, chat: { id: -100 } },
        answerCallbackQuery: true,
      }),
    );
    return Response.json({ ok: true, result: results.get(method) });
  };
  const routes = new RemoteTokenService(config);
  const signal = new SignalService(
    {
      ...hostTickets(),
      verifySlackRoute: () => Effect.succeed({ teams: [] }),
      validateSlackRoute: () => Effect.succeed([]),
      verifyTelegramRoute: (token, hostId) => routes.verifyTelegramRoute(token, hostId),
      validateTelegramRoute: (_hostId, chats) => Effect.succeed(chats),
      ...provider,
    },
    8,
    undefined,
    undefined,
    undefined,
    {
      telegram: {
        bot: new TelegramBotApi(config.telegram, { fetch, apiOrigin: "https://telegram.test" }),
        files: new TelegramFileTokens(config.sessionSecret),
      },
      routeWaker,
    },
  );
  const app = createRemoteApiApp(config, signal, signalRuntime(signal));
  const sockets = new Map<string, TestSocket>();
  const now = Math.floor(Date.now() / 1_000);

  const connect = async (id: string, chats: Array<{ id: string; linkedAt?: number }> | null, queueKey?: string) => {
    const messages: string[] = [];
    const socket: TestSocket = {
      id,
      ip: "192.0.2.1",
      messages,
      ready: "",
      signal,
      send: (message) => messages.push(message),
      close: () => {},
    };
    sockets.set(id, socket);
    signal.connect(socket);
    const telegramRoute = chats
      ? await new SignJWT({
          hid: "host-1",
          chats: chats.map((chat) => ({ id: chat.id, botId: BOT_ID, linkedAt: chat.linkedAt ?? 1_000 })),
        })
          .setProtectedHeader({ alg: "ES256", kid: "route-1" })
          .setAudience("openbot-telegram-route")
          .setIssuedAt(now - 60)
          .setExpirationTime(now + 300)
          .sign(privateKey)
      : undefined;
    await runSignal(
      signal,
      signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: "route",
          telegramRoute,
          queueKey,
        }),
      ),
    );
    socket.ready = messages.find((message) => message.includes('"type":"ready"')) ?? "";
    expect(socket.ready).not.toBe("");
    messages.splice(messages.indexOf(socket.ready), 1);
    return socket;
  };

  const postUpdate = (body: string, options: { secret?: string; botId?: string } = {}) =>
    app.handle(
      new Request(`http://localhost/v1/telegram/updates/${options.botId ?? BOT_ID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token":
            options.secret ?? telegramWebhookSecret("h".repeat(32), options.botId ?? BOT_ID),
        },
        body,
      }),
    );

  let requestNumber = 0;
  const call = async <Method extends TelegramCallMethod>(
    socket: TestSocket,
    method: Method,
    params: TelegramCallParams[Method],
    botId = BOT_ID,
  ) => {
    requestNumber += 1;
    const requestId = `request-${requestNumber}`;
    await runSignal(
      signal,
      signal.receive(socket, JSON.stringify({ type: "telegram-call", version: 1, requestId, botId, method, params })),
    );
    const answer = () => socket.messages.find((message) => message.includes(`"requestId":"${requestId}"`));
    await vi.waitFor(() => expect(answer()).toBeDefined());
    return JSON.parse(answer() ?? "{}");
  };

  // What the account service sends when it unlinks or moves a chat.
  const revoke = async (chatId: string, through: number) => {
    const body = JSON.stringify({ type: "telegram-route-revoked", botId: BOT_ID, chatId, through });
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

  return { app, connect, postUpdate, call, revoke, requests, sockets, signal };
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
