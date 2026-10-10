// The Signal protocol's server half: the shapes come from `@openbot/contracts/signal-protocol`, and
// what stays here is the validation of untrusted *client* input - byte limits, identifier patterns
// and a closed discriminated union that a client-side decoder has no reason to carry. The other
// direction is `@openbot/contracts/signal-protocol/decode`, which is what a peer runs over this
// service's output. One validator per trust direction, on purpose.
//
// The re-exports below are what the rest of this workspace imports, so moving the types out did not
// churn `signal-service.ts` or `tokens.ts`.

import {
  type SignalClientMessage,
  type SignalServerMessage,
  SLACK_DELIVERY_RESPONSE_BYTES_LIMIT,
} from "@openbot/contracts/signal-protocol/messages";
import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_TEXT_LIMIT,
  type TelegramCallMethod,
  type TelegramCallParams,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { z } from "zod";

export type {
  IceServer,
  SignalClientMessage,
  SignalErrorCode,
  SignalServerMessage,
  SlackDeliveryKind,
  SlackDeliveryStatus,
  WebhookDeliveryStatus,
} from "@openbot/contracts/signal-protocol/messages";
export {
  SIGNAL_MESSAGE_BYTES_LIMIT,
  SIGNAL_TURN_CREDENTIAL_TTL_SECONDS,
  SLACK_DELIVERY_BODY_BYTES_LIMIT,
} from "@openbot/contracts/signal-protocol/messages";
export type { RemoteTicketClaims } from "@openbot/contracts/signal-protocol/ticket";
export {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
} from "@openbot/contracts/signal-protocol/ticket";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const channelSchema = z.enum(["team", "remote-desktop"]);
const signalMessageTypeSchema = z.enum([
  "hello",
  "offer",
  "answer",
  "ice-candidate",
  "ice-restart",
  "turn-refresh",
  "disconnect",
  "slack-delivery-result",
  "webhook-delivery-result",
  "telegram-call",
  "queued-delivery-ack",
]);

// The Bot API calls an `ingress` socket can make (`TelegramCallParams`). Every object is strict: an
// extra key, such as `reply_parameters.chat_id`, could reach a chat of another host, so it fails the
// frame.
const telegramChatIdSchema = z.int();
const telegramMessageIdSchema = z.int().positive();
const telegramTextSchema = z.string().min(1).max(TELEGRAM_TEXT_LIMIT);
const telegramKeyboardSchema = z.strictObject({
  inline_keyboard: z
    .array(
      z
        .array(
          z.strictObject({
            text: z.string().min(1).max(64),
            callback_data: z.string().refine((value) => {
              const bytes = new TextEncoder().encode(value).byteLength;
              return bytes >= 1 && bytes <= 64;
            }),
          }),
        )
        .max(8),
    )
    .max(8),
});
const telegramReplyParametersSchema = z.strictObject({
  message_id: telegramMessageIdSchema,
  allow_sending_without_reply: z.boolean().optional(),
});
const telegramLinkPreviewSchema = z.strictObject({ is_disabled: z.literal(true) });
const telegramCallParamsSchemas = {
  getMe: z.strictObject({}),
  sendMessage: z.strictObject({
    chat_id: telegramChatIdSchema,
    text: telegramTextSchema,
    parse_mode: z.literal("HTML").optional(),
    message_thread_id: telegramMessageIdSchema.optional(),
    reply_parameters: telegramReplyParametersSchema.optional(),
    reply_markup: telegramKeyboardSchema.optional(),
    link_preview_options: telegramLinkPreviewSchema.optional(),
  }),
  editMessageText: z.strictObject({
    chat_id: telegramChatIdSchema,
    message_id: telegramMessageIdSchema,
    text: telegramTextSchema,
    parse_mode: z.literal("HTML").optional(),
    reply_markup: telegramKeyboardSchema.optional(),
    link_preview_options: telegramLinkPreviewSchema.optional(),
  }),
  deleteMessage: z.strictObject({ chat_id: telegramChatIdSchema, message_id: telegramMessageIdSchema }),
  setMessageReaction: z.strictObject({
    chat_id: telegramChatIdSchema,
    message_id: telegramMessageIdSchema,
    reaction: z.array(z.strictObject({ type: z.literal("emoji"), emoji: z.string().min(1).max(16) })).max(1),
  }),
  answerCallbackQuery: z.strictObject({
    callback_query_id: z.string().min(1).max(128),
    text: z.string().max(200).optional(),
    show_alert: z.boolean().optional(),
  }),
  leaveChat: z.strictObject({ chat_id: telegramChatIdSchema }),
  getFile: z.strictObject({ chat_id: telegramChatIdSchema, file_id: z.string().min(1).max(256) }),
  sendDocument: z.strictObject({
    chat_id: telegramChatIdSchema,
    file_name: z.string().min(1).max(255),
    message_thread_id: telegramMessageIdSchema.optional(),
    reply_parameters: telegramReplyParametersSchema.optional(),
  }),
} satisfies { [Method in TelegramCallMethod]: z.ZodType<TelegramCallParams[Method]> };
const telegramCall = <Method extends TelegramCallMethod>(method: Method) =>
  z.object({
    type: z.literal("telegram-call"),
    version: z.literal(1),
    requestId: identifierSchema,
    botId: z.string().regex(TELEGRAM_BOT_ID_PATTERN),
    method: z.literal(method),
    params: telegramCallParamsSchemas[method],
  });
const telegramCallSchema = z.discriminatedUnion("method", [
  telegramCall("getMe"),
  telegramCall("sendMessage"),
  telegramCall("editMessageText"),
  telegramCall("deleteMessage"),
  telegramCall("setMessageReaction"),
  telegramCall("answerCallbackQuery"),
  telegramCall("leaveChat"),
  telegramCall("getFile"),
  telegramCall("sendDocument"),
]);

const signalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    version: z.literal(1),
    peer: z.enum(["host", "client", "ingress"]),
    token: z.string().min(1).max(8_192),
    multiplex: z.boolean().optional(),
    slackRoute: z.string().min(1).max(8_192).optional(),
    discordRoute: z.string().min(1).max(8_192).optional(),
    webhookRoute: z.string().min(1).max(8_192).optional(),
    telegramRoute: z.string().min(1).max(16_384).optional(),
    queueKey: z.string().max(128).optional(),
  }),
  z.object({
    type: z.enum(["offer", "answer"]),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
    sdp: z.string().min(1).max(60_000),
  }),
  z.object({
    type: z.literal("ice-candidate"),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
    candidate: z.string().min(1).max(8_192),
    sdpMid: z.string().min(1).max(256).nullable(),
    sdpMLineIndex: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal("ice-restart"),
    version: z.literal(1),
    connectionId: identifierSchema,
    channel: channelSchema,
  }),
  z.object({
    type: z.literal("turn-refresh"),
    version: z.literal(1),
    connectionId: identifierSchema.nullable(),
  }),
  z.object({
    type: z.literal("disconnect"),
    version: z.literal(1),
    connectionId: identifierSchema,
  }),
  z.object({
    type: z.literal("slack-delivery-result"),
    version: z.literal(1),
    requestId: identifierSchema,
    status: z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(404), z.literal(503)]),
    contentType: z.enum(["application/json", "text/plain"]).optional(),
    body: z.string().max(SLACK_DELIVERY_RESPONSE_BYTES_LIMIT).optional(),
  }),
  z.object({
    type: z.literal("queued-delivery-ack"),
    version: z.literal(1),
    id: identifierSchema,
  }),
  z.object({
    type: z.literal("webhook-delivery-result"),
    version: z.literal(1),
    requestId: identifierSchema,
    status: z.union([
      z.literal(200),
      z.literal(202),
      z.literal(400),
      z.literal(401),
      z.literal(404),
      z.literal(413),
      z.literal(429),
      z.literal(503),
    ]),
  }),
  telegramCallSchema,
]) satisfies z.ZodType<SignalClientMessage>;

/** A decoded client frame. A `telegram-call` keeps the link between its `method` and its `params`. */
export type DecodedSignalClientMessage = z.output<typeof signalClientMessageSchema>;
export type TelegramCall = z.output<typeof telegramCallSchema>;

export function decodeSignalClientMessage(value: unknown): DecodedSignalClientMessage {
  const envelope = z.object({ type: z.string() }).safeParse(value);
  if (envelope.success && !signalMessageTypeSchema.safeParse(envelope.data.type).success) {
    throw new Error("Unsupported signal message.");
  }
  return signalClientMessageSchema.parse(value);
}

export function encodeSignalServerMessage(message: SignalServerMessage): string {
  return JSON.stringify(message);
}
