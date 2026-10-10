// The client half of the Signal protocol's validation: what a peer runs over the frames the service
// sends it. The service's own half - the untrusted client input it accepts - stays in
// `remote/api/src/protocol.ts` as zod, with byte limits and identifier patterns this does not need.
// One validator per trust direction; see `./messages.ts` for why they are not shared.
//
// Guards rather than a schema library because `@openbot/contracts` has one runtime dependency and is
// in the graph of a Cloudflare Worker, a React Native app and an Electron renderer. Adding zod here
// would push it into all three.

import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeDiscordDelivery } from "./discord-api";
import { DISCORD_ROUTE_GUILDS_LIMIT } from "./discord-route";
import {
  type IceServer,
  QUEUED_DELIVERY_SEALED_LIMIT,
  SIGNAL_PROTOCOL_VERSION,
  type SignalChannel,
  type SignalServerMessage,
  SLACK_DELIVERY_BODY_BYTES_LIMIT,
  type SlackDeliveryKind,
  WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
} from "./messages";
import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_UPDATE_BYTES_LIMIT,
  type TelegramCallResult,
} from "./telegram-route";
import {
  WEBHOOK_DELIVERY_ID_PATTERN,
  WEBHOOK_ROUTE_ID_PATTERN,
  WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_TIMESTAMP_PATTERN,
} from "./webhook-route";

/**
 * Returns `null` for a frame whose `type` this version does not know: a newer Signal service may add
 * one, and a client already installed on a phone has to ignore it rather than drop the connection.
 * Throws for anything that is not a frame at all, or for a known type whose payload does not match -
 * both mean the peer cannot trust what follows.
 */
export function decodeSignalServerMessage(value: unknown): SignalServerMessage | null {
  if (!isDynamicRecord(value) || value.version !== SIGNAL_PROTOCOL_VERSION || !isString(value.type)) invalid();
  const version = SIGNAL_PROTOCOL_VERSION;
  const kind = value.type;
  switch (kind) {
    case "account-profile-changed":
    case "account-servers-changed":
      return { type: kind, version };
    case "ready":
      return {
        type: kind,
        version,
        connectionId: value.connectionId === null ? null : identifier(value.connectionId),
        resumeToken: identifier(value.resumeToken),
        iceServers: iceServers(value.iceServers),
        ...(value.capabilities === undefined ? {} : { capabilities: capabilities(value.capabilities) }),
      };
    case "peer-ready":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        sessionId: identifier(value.sessionId),
        userId: identifier(value.userId),
        membershipId: identifier(value.membershipId),
        role: memberRole(value.role),
        sessionExpiresAt: timestamp(value.sessionExpiresAt),
        resumed: flag(value.resumed),
      };
    case "error":
      return {
        type: kind,
        version,
        code: identifier(value.code),
        message: text(value.message),
        ...(value.connectionId === undefined ? {} : { connectionId: identifier(value.connectionId) }),
      };
    case "offer":
    case "answer":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        channel: channel(value.channel),
        sdp: identifier(value.sdp),
      };
    case "ice-candidate":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        channel: channel(value.channel),
        candidate: identifier(value.candidate),
        sdpMid: value.sdpMid === null ? null : identifier(value.sdpMid),
        sdpMLineIndex: value.sdpMLineIndex === null ? null : mLineIndex(value.sdpMLineIndex),
      };
    case "ice-restart":
      return { type: kind, version, connectionId: identifier(value.connectionId), channel: channel(value.channel) };
    case "turn-refresh":
      return {
        type: kind,
        version,
        connectionId: value.connectionId === null ? null : identifier(value.connectionId),
      };
    case "disconnect":
      return { type: kind, version, connectionId: identifier(value.connectionId) };
    case "slack-delivery":
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        teamId: identifier(value.teamId),
        kind: deliveryKind(value.kind),
        retryNum: value.retryNum === null ? null : retryNumber(value.retryNum),
        retryReason: value.retryReason === null ? null : identifier(value.retryReason),
        bodyBase64: deliveryBody(value.bodyBase64, SLACK_DELIVERY_BODY_BYTES_LIMIT),
      };
    case "webhook-delivery":
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        routeId: matching(value.routeId, WEBHOOK_ROUTE_ID_PATTERN),
        timestamp: matching(value.timestamp, WEBHOOK_TIMESTAMP_PATTERN),
        deliveryId: matching(value.deliveryId, WEBHOOK_DELIVERY_ID_PATTERN),
        signature: matching(value.signature, WEBHOOK_SIGNATURE_PATTERN),
        bodyBase64: deliveryBody(value.bodyBase64, WEBHOOK_DELIVERY_BODY_BYTES_LIMIT),
      };
    case "discord-session":
      return { type: kind, version, token: identifier(value.token), guilds: guildList(value.guilds) };
    case "webhook-ready":
      return { type: kind, version };
    case "discord-delivery":
      return {
        type: kind,
        version,
        guildId: identifier(value.guildId),
        delivery: decodeDiscordDelivery(value.delivery),
      };
    case "queued-delivery": {
      const sealed = text(value.sealed);
      if (sealed.length === 0 || sealed.length > QUEUED_DELIVERY_SEALED_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(sealed))
        invalid();
      return { type: kind, version, id: identifier(value.id), sealed };
    }
    case "telegram-delivery":
      if (value.linked !== undefined && value.linked !== true) invalid();
      return {
        type: kind,
        version,
        botId: matching(value.botId, TELEGRAM_BOT_ID_PATTERN),
        chatId: matching(value.chatId, TELEGRAM_CHAT_ID_PATTERN),
        bodyBase64: deliveryBody(value.bodyBase64, TELEGRAM_UPDATE_BYTES_LIMIT),
        ...(value.linked === true ? { linked: true as const } : {}),
      };
    case "telegram-call-result":
      if (value.ok === true)
        return {
          type: kind,
          version,
          requestId: identifier(value.requestId),
          ok: true,
          result: telegramResult(value.result),
        };
      if (value.ok !== false) invalid();
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        ok: false,
        errorCode: integer(value.errorCode),
        description: text(value.description).slice(0, 256),
        ...(value.retryAfter === undefined ? {} : { retryAfter: retryNumber(value.retryAfter) }),
      };
    default:
      return null;
  }
}

function invalid(): never {
  throw new Error("Signal returned an invalid message.");
}

function text(value: unknown): string {
  if (!isString(value)) invalid();
  return value;
}

// Every identifier, token and SDP blob on this wire: the service rejects an empty one on the way in,
// so an empty one on the way out is a frame the peer cannot act on either.
function identifier(value: unknown): string {
  const candidate = text(value);
  if (candidate.length === 0) invalid();
  return candidate;
}

function integer(value: unknown): number {
  if (!isNumber(value) || !Number.isInteger(value)) invalid();
  return value;
}

// An expiry at or before the epoch dates a session that cannot exist, and it does not stop at this
// peer: the renderer forwards it to the main process, whose bridge schema requires a positive
// integer and parses inside the port listener, so a zero arrives there as a throw rather than a
// refused frame.
function timestamp(value: unknown): number {
  const candidate = integer(value);
  if (candidate <= 0) invalid();
  return candidate;
}

// Zero is the first m-line, so this bound is `< 0` rather than the timestamp's `<= 0`. The Signal
// service takes `nonnegative` on the way in, and a negative index is the malformed known payload
// that has the furthest to travel before anything notices: it decodes, reaches `addIceCandidate`,
// and the browser's refusal arrives as a WebRTC failure a reconnect is allowed to retry past. The
// two ends disagreeing about the wire is a `protocol_error`, and it is only one here.
function mLineIndex(value: unknown): number {
  const candidate = integer(value);
  if (candidate < 0) invalid();
  return candidate;
}

function flag(value: unknown): boolean {
  if (!isBoolean(value)) invalid();
  return value;
}

function retryNumber(value: unknown): number {
  const candidate = integer(value);
  if (candidate < 0) invalid();
  return candidate;
}

function deliveryKind(value: unknown): SlackDeliveryKind {
  if (value !== "events" && value !== "interactivity") invalid();
  return value;
}

// Base64 of at most the body limit.
function deliveryBody(value: unknown, bytesLimit: number): string {
  const candidate = text(value);
  if (candidate.length > Math.ceil(bytesLimit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(candidate)) invalid();
  return candidate;
}

function matching(value: unknown, pattern: RegExp): string {
  const candidate = text(value);
  if (!pattern.test(candidate)) invalid();
  return candidate;
}

function guildList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > DISCORD_ROUTE_GUILDS_LIMIT) invalid();
  return value.map(identifier);
}

// Unknown capabilities are kept: a host acts only on the ones it knows.
function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) invalid();
  return value.map(identifier);
}

function telegramResult(value: unknown): TelegramCallResult {
  if (!isDynamicRecord(value)) invalid();
  return {
    ...(value.messageId === undefined ? {} : { messageId: integer(value.messageId) }),
    ...(value.botId === undefined ? {} : { botId: matching(value.botId, TELEGRAM_BOT_ID_PATTERN) }),
    ...(value.username === undefined ? {} : { username: identifier(value.username) }),
    ...(value.fileToken === undefined ? {} : { fileToken: identifier(value.fileToken) }),
    ...(value.fileSize === undefined ? {} : { fileSize: retryNumber(value.fileSize) }),
    ...(value.uploadToken === undefined ? {} : { uploadToken: identifier(value.uploadToken) }),
  };
}

function channel(value: unknown): SignalChannel {
  if (value !== "team" && value !== "remote-desktop") invalid();
  return value;
}

function memberRole(value: unknown): "owner" | "admin" | "member" {
  if (value !== "owner" && value !== "admin" && value !== "member") invalid();
  return value;
}

// Deliberately tolerant of an empty list. A deployment with no TURN configured is a decision its
// operator gets to make, and refusing the frame here would take that decision away from every
// client at once.
function iceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value)) invalid();
  return value.map(iceServer);
}

function iceServer(value: unknown): IceServer {
  if (!isDynamicRecord(value)) invalid();
  return {
    urls: isString(value.urls) ? value.urls : urlList(value.urls),
    ...(value.username === undefined ? {} : { username: text(value.username) }),
    ...(value.credential === undefined ? {} : { credential: text(value.credential) }),
  };
}

function urlList(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  return value.map(text);
}
