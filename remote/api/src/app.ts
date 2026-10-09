import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import {
  DISCORD_UPLOAD_BYTES_LIMIT,
  type DiscordApiErrorBody,
  type DiscordApiErrorCode,
  type DiscordApiRequest,
} from "@openbot/contracts/signal-protocol/discord-api";
import { DISCORD_API_PATH } from "@openbot/contracts/signal-protocol/discord-route";
import {
  WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
  type WebhookDeliveryStatus,
} from "@openbot/contracts/signal-protocol/messages";
import { SLACK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/slack-route";
import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_FILE_BYTES_LIMIT,
  TELEGRAM_FILES_PATH,
  TELEGRAM_LINK_CODE_PATTERN,
  TELEGRAM_UPDATE_BYTES_LIMIT,
  TELEGRAM_UPDATES_PATH,
  TELEGRAM_UPLOADS_PATH,
  type TelegramUploadAnswer,
} from "@openbot/contracts/signal-protocol/telegram-route";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_DELIVERY_ID_PATTERN,
  WEBHOOK_EVENTS_PATH,
  WEBHOOK_ROUTE_ID_PATTERN,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_PATTERN,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Effect, type ManagedRuntime, Result } from "effect";
import { Elysia } from "elysia";
import { z } from "zod";
import type { RemoteApiConfig } from "./config";
import { type DiscordApi, type DiscordUpload, decodeDiscordApiRequest } from "./discord-api";
import { SLACK_DELIVERY_BODY_BYTES_LIMIT, type SlackDeliveryKind } from "./protocol";
import type { SignalService, SignalSocket, SignalTokens, SlackDeliveryResponse } from "./signal-service";
import { telegramFailure } from "./telegram";
import { verifySlackSignature, verifyWebhookSignature } from "./tokens";

const SLACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SLACK_RETRY_REASON_PATTERN = /^[a-z0-9_]{1,64}$/u;
const DISCORD_SESSION_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/u;
// A JSON call holds at most 2,000 characters of text and five buttons.
const DISCORD_JSON_BODY_BYTES_LIMIT = 64 * 1024;
// The multipart fields and boundaries around one file.
const DISCORD_UPLOAD_BODY_BYTES_LIMIT = DISCORD_UPLOAD_BYTES_LIMIT + 64 * 1024;

const slackRequestSchema = z.object({
  type: z.string().optional(),
  api_app_id: z.string().optional(),
  challenge: z.string().max(1_024).optional(),
  team_id: z.string().optional(),
  team: z.object({ id: z.string() }).nullish(),
  authorizations: z.array(z.object({ team_id: z.string() })).optional(),
});

// The only parts of a Telegram update that Signal reads: the chat, the callback query, and the text
// of a message, only to find a link code.
const telegramChatSchema = z.object({ id: z.int() });
const telegramUpdateSchema = z.object({
  message: z.object({ chat: telegramChatSchema, text: z.string().optional() }).optional(),
  edited_message: z.object({ chat: telegramChatSchema }).optional(),
  callback_query: z.object({ id: z.string(), message: z.object({ chat: telegramChatSchema }).optional() }).optional(),
  my_chat_member: z.object({ chat: telegramChatSchema }).optional(),
});
const TELEGRAM_START_PATTERN = new RegExp(
  `^/start(?:@[A-Za-z0-9_]{1,64})?\\s+(${TELEGRAM_LINK_CODE_PATTERN.source.slice(1, -1)})$`,
  "u",
);

const authEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account-profile-changed"), userId: z.string().min(1) }),
  z.object({ type: z.literal("account-servers-changed"), userId: z.string().min(1) }),
  z.object({
    type: z.literal("remote-auth-changed"),
    hostId: z.string().min(1),
    authEpoch: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("remote-session-ended"),
    hostId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("slack-route-revoked"),
    appId: z.string().min(1),
    teamId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("discord-route-revoked"),
    guildId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("webhook-route-revoked"),
    routeId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("telegram-route-revoked"),
    botId: z.string().regex(TELEGRAM_BOT_ID_PATTERN),
    chatId: z.string().regex(TELEGRAM_CHAT_ID_PATTERN),
    through: z.number().int().nonnegative(),
  }),
]) satisfies z.ZodType<RemoteAuthEvent>;

export function createRemoteApiApp(
  config: RemoteApiConfig,
  signal: SignalService,
  runtime: ManagedRuntime.ManagedRuntime<SignalTokens, never>,
  // Null when Signal has no Discord bot token: the Discord route answers 503.
  discord: DiscordApi | null = null,
) {
  const app = new Elysia()
    .get("/health/live", () => ({ service: "openbot-remote-api", status: "live", commit: config.sourceCommit }))
    .get("/health/ready", () => ({ service: "openbot-remote-api", status: "ready" }))
    .post("/internal/auth-events", async ({ request, set }) => {
      const timestamp = request.headers.get("OpenBot-Timestamp") ?? "";
      const signature = request.headers.get("OpenBot-Signature") ?? "";
      const body = await request.text();
      if (!verifyWebhookSignature(body, timestamp, signature, config.authWebhookSecret)) {
        set.status = 401;
        return { error: { code: "invalid_signature", message: "The auth event signature is invalid." } };
      }
      const event = decodeAuthEvent(body);
      if (!event) {
        set.status = 400;
        return { error: { code: "invalid_event", message: "The auth event is invalid." } };
      }
      if (event.type === "remote-auth-changed") signal.revoke(event.hostId, event.authEpoch);
      else if (event.type === "account-profile-changed") signal.profileChanged(event.userId);
      else if (event.type === "account-servers-changed") signal.serversChanged(event.userId);
      else if (event.type === "slack-route-revoked") signal.revokeSlackRoute(event.appId, event.teamId, event.through);
      else if (event.type === "telegram-route-revoked")
        signal.revokeTelegramRoute(event.botId, event.chatId, event.through);
      else if (event.type === "discord-route-revoked") signal.revokeDiscordRoute(event.guildId, event.through);
      else if (event.type === "webhook-route-revoked") signal.revokeWebhookRoute(event.routeId, event.through);
      else signal.revokeSession(event.sessionId);
      return new Response(null, { status: 204 });
    })
    // The OpenBot Slack app's one request URL, for the events and button presses of every
    // workspace. Signal checks Slack's signature, reads only the app and workspace IDs, and passes the
    // exact body to the ingress socket of the host that the app's workspace is linked to. Nothing here stores or
    // logs the body.
    .post(
      SLACK_EVENTS_PATH,
      async ({ request, server }) => {
        if (config.slackSigningSecrets.length === 0) return slackResponse({ status: 503 });
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(declaredLength) || declaredLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) {
          return slackResponse({ status: 413 });
        }
        const kind = slackDeliveryKind(request.headers.get("content-type"));
        if (!kind) return slackResponse({ status: 415 });
        const body = new Uint8Array(await request.arrayBuffer());
        if (body.byteLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) return slackResponse({ status: 413 });
        const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
        const signature = request.headers.get("x-slack-signature") ?? "";
        const signer = config.slackSigningSecrets.find(({ secret }) =>
          verifySlackSignature(body, timestamp, signature, secret),
        );
        if (!signer) {
          const address = signalClientIp(
            server?.requestIP(request)?.address,
            request.headers.get("x-forwarded-for"),
            config.trustProxy,
          );
          return slackResponse({ status: signal.acceptSlackRequest(`address:${address}`) ? 401 : 429 });
        }
        const slack = slackRequest(kind, body);
        if (!slack) return slackResponse({ status: 400 });
        if ("challenge" in slack) {
          return slackResponse({ status: 200, contentType: "text/plain", body: slack.challenge });
        }
        // The secret binds the app: a request signed by one app cannot reach another app's route.
        if (slack.appId !== signer.appId) return slackResponse({ status: 401 });
        if (!signal.acceptSlackRequest(`team:${slack.teamId}`)) return slackResponse({ status: 429 });
        const retryNum = Number(request.headers.get("x-slack-retry-num") ?? "");
        const retryReason = request.headers.get("x-slack-retry-reason");
        return slackResponse(
          await runtime.runPromise(
            signal.deliverSlack(slack.appId, slack.teamId, {
              kind,
              retryNum: Number.isInteger(retryNum) && retryNum >= 0 && retryNum < 100 ? retryNum : null,
              retryReason: retryReason && SLACK_RETRY_REASON_PATTERN.test(retryReason) ? retryReason : null,
              body,
            }),
            { signal: request.signal },
          ),
        );
      },
      { parse: "none" },
    )
    // The host authenticates each generic webhook request with the secret of its webhook routine. Signal
    // only bounds the body, limits ingress and relays the exact bytes plus signed header values. It
    // checks the headers and that a host holds the route before it spends a rate window or reads the body.
    .post(
      `${WEBHOOK_EVENTS_PATH}/:routeId`,
      async ({ request, params, server }) => {
        const routeId = params.routeId;
        if (!WEBHOOK_ROUTE_ID_PATTERN.test(routeId)) return webhookResponse(404);
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(declaredLength) || declaredLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) {
          return webhookResponse(413);
        }
        const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (mediaType !== "application/json") return webhookResponse(415);
        const timestamp = request.headers.get(WEBHOOK_TIMESTAMP_HEADER) ?? "";
        const deliveryId = request.headers.get(WEBHOOK_DELIVERY_ID_HEADER) ?? "";
        const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER) ?? "";
        if (
          !WEBHOOK_TIMESTAMP_PATTERN.test(timestamp) ||
          !WEBHOOK_DELIVERY_ID_PATTERN.test(deliveryId) ||
          !WEBHOOK_SIGNATURE_PATTERN.test(signature)
        ) {
          return webhookResponse(401);
        }
        if (!signal.holdsWebhookRoute(routeId)) return webhookResponse(503);
        const address = signalClientIp(
          server?.requestIP(request)?.address,
          request.headers.get("x-forwarded-for"),
          config.trustProxy,
        );
        if (!signal.acceptWebhookRequest(`${routeId}:${address}`)) return webhookResponse(429);
        const body = await readBounded(request, WEBHOOK_DELIVERY_BODY_BYTES_LIMIT);
        if (!body) return webhookResponse(413);
        const result = await runtime.runPromise(
          signal.deliverWebhook(routeId, { timestamp, deliveryId, signature, body }),
          { signal: request.signal },
        );
        return webhookResponse(result.status);
      },
      { parse: "none" },
    )
    // The Discord calls of a host, with the `discord-session` token of its `ingress` socket. Signal makes
    // each call with the bot token, only in a guild routed to that socket. Nothing here stores or logs
    // the body or Discord's answer.
    .post(
      DISCORD_API_PATH,
      async ({ request }) => {
        if (!discord) return discordError(503, "unavailable");
        const token = DISCORD_SESSION_PATTERN.exec(request.headers.get("authorization") ?? "")?.[1];
        const session = token ? signal.discordCaller(token, null) : null;
        if (!token || !session?.ok) return discordError(401, "unauthorized");
        const retryAfterMs = signal.acceptDiscordCall(session.hostId);
        if (retryAfterMs !== null) return discordError(429, "rate_limited", retryAfterMs);
        const input = await readDiscordCall(request);
        if ("status" in input) return discordError(input.status, "invalid_request");
        const caller = signal.discordCaller(token, input.request.guildId);
        if (!caller.ok) return discordError(caller.code === "unauthorized" ? 401 : 403, caller.code);
        const result = await runtime.runPromise(discord.call(input.request, input.file).pipe(Effect.result), {
          signal: request.signal,
        });
        signal.recordDiscordCall(Result.isSuccess(result));
        if (Result.isFailure(result)) {
          return discordError(result.failure.status, result.failure.code, result.failure.retryAfterMs);
        }
        return Response.json(result.success, { headers: { "Cache-Control": "no-store" } });
      },
      { parse: "none" },
    )
    // The webhook of each OpenBot Telegram bot. Signal checks the bot's secret header, reads only the
    // chat, the callback query and a link code, and passes the exact body to the ingress socket of
    // the chat's host. Nothing here stores or logs the body. A signed update is always answered 200:
    // Telegram holds back the bot's other updates while one fails.
    .post(
      `${TELEGRAM_UPDATES_PATH}/:botId`,
      async ({ params, request, server }) => {
        const telegram = signal.telegram;
        const botId = params.botId;
        if (!telegram?.bot.hasBot(botId)) return emptyResponse(404);
        if (!telegram.bot.verifyWebhook(botId, request.headers.get("x-telegram-bot-api-secret-token") ?? "")) {
          await request.body?.cancel();
          const address = signalClientIp(
            server?.requestIP(request)?.address,
            request.headers.get("x-forwarded-for"),
            config.trustProxy,
          );
          return emptyResponse(signal.acceptTelegramRequest(`address:${address}`) ? 401 : 429);
        }
        const body = await readBody(request, TELEGRAM_UPDATE_BYTES_LIMIT);
        const update = body ? telegramUpdate(body) : null;
        if (!body || !update || !signal.acceptTelegramRequest(`chat:${botId}:${update.chatId}`))
          return emptyResponse(200);
        const linked = update.linkCode
          ? await runtime.runPromise(signal.linkTelegramChat(botId, update.chatId, update.linkCode))
          : false;
        signal.deliverTelegram(botId, update.chatId, body, update.callbackQueryId, linked);
        return emptyResponse(200);
      },
      { parse: "none" },
    )
    // One file of an update, for the host that received a file token for it.
    .get(`${TELEGRAM_FILES_PATH}/:token`, async ({ params }) => {
      const telegram = signal.telegram;
      const grant = telegram?.files.verifyFile(params.token);
      if (!telegram || !grant) return emptyResponse(404);
      const response = await runtime.runPromise(telegram.bot.download(grant.botId, grant.filePath)).catch(() => null);
      const declaredLength = Number(response?.headers.get("content-length") ?? "0");
      if (
        !response?.ok ||
        !response.body ||
        !Number.isFinite(declaredLength) ||
        declaredLength > TELEGRAM_FILE_BYTES_LIMIT
      ) {
        await response?.body?.cancel();
        return emptyResponse(502);
      }
      return new Response(limitStream(response.body, TELEGRAM_FILE_BYTES_LIMIT), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/octet-stream",
          ...(declaredLength > 0 ? { "Content-Length": String(declaredLength) } : {}),
        },
      });
    })
    // One document into the chat that an upload token names. The token works once.
    .post(
      `${TELEGRAM_UPLOADS_PATH}/:token`,
      async ({ params, request }) => {
        const telegram = signal.telegram;
        const grant = telegram?.files.consumeUpload(params.token);
        if (!telegram || !grant) {
          await request.body?.cancel();
          return emptyResponse(404);
        }
        const body = await readBody(request, TELEGRAM_FILE_BYTES_LIMIT);
        if (!body) return uploadResponse(telegramFailure(413, "Request Entity Too Large"), 413);
        return uploadResponse(await runtime.runPromise(telegram.bot.sendDocument(grant, body)));
      },
      { parse: "none" },
    )
    .ws("/v1/signal", {
      idleTimeout: 120,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 256 * 1024,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
      open(ws) {
        signal.connect(socketAdapter(ws, config.trustProxy));
      },
      async message(ws, message) {
        const socket = socketAdapter(ws, config.trustProxy);
        const textMessage = z.string().safeParse(message);
        const input = textMessage.success
          ? textMessage.data
          : message instanceof Uint8Array
            ? message
            : JSON.stringify(message);
        await runtime.runPromise(signal.receive(socket, input));
      },
      async close(ws) {
        await runtime.runPromise(signal.disconnect(socketAdapter(ws, config.trustProxy)));
      },
      error({ error }) {
        console.error("Remote signal WebSocket failed.", error instanceof Error ? error.message : "Unknown error");
      },
    });
  return app;
}

interface ElysiaSocketLike {
  id: string;
  data?: { request?: Request };
  remoteAddress?: string;
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}

function socketAdapter(ws: ElysiaSocketLike, trustProxy: boolean): SignalSocket {
  return {
    id: ws.id,
    ip: signalClientIp(ws.remoteAddress, ws.data?.request?.headers.get("x-forwarded-for"), trustProxy),
    send: (message) => {
      ws.send(message);
    },
    close: (code, reason) => ws.close(code, reason.slice(0, 123)),
  };
}

export function signalClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | null | undefined,
  trustProxy: boolean,
) {
  if (!trustProxy) return remoteAddress ?? "unknown";
  const forwarded = forwardedFor?.split(",", 1)[0]?.trim();
  return forwarded || remoteAddress || "unknown";
}

function slackDeliveryKind(contentType: string | null): SlackDeliveryKind | null {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json") return "events";
  if (mediaType === "application/x-www-form-urlencoded") return "interactivity";
  return null;
}

/**
 * The only parts of a signed Slack request that Signal reads: the `url_verification` challenge, which
 * Signal answers itself, or the workspace ID that picks the host. Events carry it as `team_id`, and
 * button presses as `payload.team.id`.
 */
function slackRequest(
  kind: SlackDeliveryKind,
  body: Uint8Array,
): { challenge: string } | { appId: string; teamId: string } | null {
  let value: unknown;
  try {
    const text = new TextDecoder().decode(body);
    value = kind === "events" ? JSON.parse(text) : JSON.parse(new URLSearchParams(text).get("payload") ?? "null");
  } catch {
    return null;
  }
  const parsed = slackRequestSchema.safeParse(value);
  if (!parsed.success) return null;
  if (kind === "events" && parsed.data.type === "url_verification" && parsed.data.challenge) {
    return { challenge: parsed.data.challenge };
  }
  const teamId = parsed.data.team_id ?? parsed.data.team?.id ?? parsed.data.authorizations?.[0]?.team_id;
  const appId = parsed.data.api_app_id;
  return teamId && appId && SLACK_ID_PATTERN.test(teamId) && SLACK_ID_PATTERN.test(appId) ? { appId, teamId } : null;
}

function slackResponse(response: SlackDeliveryResponse | { status: 413 | 415 | 429 | 401 | 400 | 503 }): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if ("contentType" in response && response.contentType && response.body !== undefined) {
    headers["Content-Type"] = response.contentType;
    return new Response(response.body, { status: response.status, headers });
  }
  return new Response(null, { status: response.status, headers });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function uploadResponse(answer: TelegramUploadAnswer, status = 200): Response {
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}

/** The request body, or `null` when it is larger than `limit`. Signal stops reading at the limit. */
async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > limit) {
    await request.body?.cancel();
    return null;
  }
  return readBounded(request, limit);
}

function webhookResponse(status: WebhookDeliveryStatus | 415): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The request of one Discord call: JSON, or `multipart/form-data` with the JSON in `request` and the
 * bytes in `file` for an upload. Signal stops reading at the size limit.
 */
async function readDiscordCall(
  request: Request,
): Promise<{ request: DiscordApiRequest; file: DiscordUpload | null } | { status: 400 | 413 }> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const multipart = mediaType === "multipart/form-data";
  if (!multipart && mediaType !== "application/json") return { status: 400 };
  const limit = multipart ? DISCORD_UPLOAD_BODY_BYTES_LIMIT : DISCORD_JSON_BODY_BYTES_LIMIT;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > limit) return { status: 413 };
  try {
    const body = await readBounded(request, limit);
    if (!body) return { status: 413 };
    if (!multipart) {
      const call = decodeDiscordApiRequest(JSON.parse(new TextDecoder().decode(body)));
      return call && call.op !== "upload" ? { request: call, file: null } : { status: 400 };
    }
    const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
    const fields = form.get("request");
    const file = form.get("file");
    if (typeof fields !== "string" || !(file instanceof Blob)) return { status: 400 };
    if (file.size > DISCORD_UPLOAD_BYTES_LIMIT) return { status: 413 };
    const call = decodeDiscordApiRequest(JSON.parse(fields));
    if (call?.op !== "upload" || file.size === 0) return { status: 400 };
    return {
      request: call,
      file: { name: call.filename, data: new Uint8Array(await file.arrayBuffer()), contentType: file.type || null },
    };
  } catch {
    return { status: 400 };
  }
}

/** The body, or null when it is larger than `limit` bytes. */
async function readBounded(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function discordError(status: number, code: DiscordApiErrorCode, retryAfterMs?: number): Response {
  const body: DiscordApiErrorBody = { error: retryAfterMs === undefined ? { code } : { code, retryAfterMs } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Passes at most `limit` bytes, and fails the stream past them. */
function limitStream(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) controller.error(new Error("The Telegram file is too large."));
        else controller.enqueue(chunk);
      },
    }),
  );
}

function telegramUpdate(
  body: Uint8Array,
): { chatId: string; callbackQueryId: string | null; linkCode: string | null } | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const parsed = telegramUpdateSchema.safeParse(value);
  if (!parsed.success) return null;
  const update = parsed.data;
  const chat =
    update.message?.chat ??
    update.edited_message?.chat ??
    update.callback_query?.message?.chat ??
    update.my_chat_member?.chat;
  const chatId = chat ? String(chat.id) : null;
  if (!chatId || !TELEGRAM_CHAT_ID_PATTERN.test(chatId)) return null;
  const callbackQueryId = update.callback_query?.id ?? "";
  return {
    chatId,
    callbackQueryId: callbackQueryId.length > 0 && callbackQueryId.length <= 128 ? callbackQueryId : null,
    linkCode: update.message?.text?.match(TELEGRAM_START_PATTERN)?.[1] ?? null,
  };
}

function decodeAuthEvent(body: string): RemoteAuthEvent | null {
  try {
    const result = authEventSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function prometheusMetrics(signal: SignalService): string {
  const metrics = signal.metrics();
  return [
    "# TYPE openbot_remote_signal_sockets gauge",
    `openbot_remote_signal_sockets ${metrics.activeSockets}`,
    "# TYPE openbot_remote_peer_connections gauge",
    `openbot_remote_peer_connections ${metrics.activePeerConnections}`,
    "# TYPE openbot_remote_signal_messages_total counter",
    `openbot_remote_signal_messages_total ${metrics.relayedMessages}`,
    "# TYPE openbot_remote_auth_failures_total counter",
    `openbot_remote_auth_failures_total ${metrics.authenticationFailures}`,
    "# TYPE openbot_remote_protocol_failures_total counter",
    `openbot_remote_protocol_failures_total ${metrics.protocolFailures}`,
    "# TYPE openbot_remote_slack_deliveries_total counter",
    `openbot_remote_slack_deliveries_total ${metrics.slackDeliveries}`,
    "# TYPE openbot_remote_slack_deliveries_unavailable_total counter",
    `openbot_remote_slack_deliveries_unavailable_total ${metrics.slackDeliveriesUnavailable}`,
    "# TYPE openbot_remote_telegram_deliveries_total counter",
    `openbot_remote_telegram_deliveries_total ${metrics.telegramDeliveries}`,
    "# TYPE openbot_remote_telegram_deliveries_unrouted_total counter",
    `openbot_remote_telegram_deliveries_unrouted_total ${metrics.telegramDeliveriesUnrouted}`,
    "# TYPE openbot_remote_telegram_calls_total counter",
    `openbot_remote_telegram_calls_total ${metrics.telegramCalls}`,
    "# TYPE openbot_remote_telegram_calls_refused_total counter",
    `openbot_remote_telegram_calls_refused_total ${metrics.telegramCallsRefused}`,
    "# TYPE openbot_remote_discord_deliveries_total counter",
    `openbot_remote_discord_deliveries_total ${metrics.discordDeliveries}`,
    "# TYPE openbot_remote_discord_deliveries_unavailable_total counter",
    `openbot_remote_discord_deliveries_unavailable_total ${metrics.discordDeliveriesUnavailable}`,
    "# TYPE openbot_remote_discord_api_calls_total counter",
    `openbot_remote_discord_api_calls_total ${metrics.discordApiCalls}`,
    "# TYPE openbot_remote_discord_api_failures_total counter",
    `openbot_remote_discord_api_failures_total ${metrics.discordApiFailures}`,
    "",
  ].join("\n");
}
