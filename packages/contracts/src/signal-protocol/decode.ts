import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeDiscordDelivery } from "./discord-api";
import { DISCORD_ROUTE_GUILDS_LIMIT } from "./discord-route";
import { GITHUB_DELIVERY_BODY_BYTES_LIMIT, GITHUB_DELIVERY_ID_PATTERN, GITHUB_EVENT_PATTERN } from "./github-route";
import {
  type IceServer,
  INGRESS_ROUTES_STATUSES,
  type IngressRoutesStatus,
  QUEUED_DELIVERY_SEALED_LIMIT,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_SESSIONS_ENDED_LIMIT,
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
import { decodeWatchRelayHttpRequest } from "./watch-relay";
import {
  STANDARD_WEBHOOK_SIGNATURE_PATTERN,
  STANDARD_WEBHOOKS_FORMAT,
  WEBHOOK_DELIVERY_ID_PATTERN,
  WEBHOOK_ROUTE_ID_PATTERN,
  WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_TIMESTAMP_PATTERN,
} from "./webhook-route";

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
        ...(value.reconnectGraceMs === undefined ? {} : { reconnectGraceMs: duration(value.reconnectGraceMs) }),
      };
    case "host-waiting":
      return { type: kind, version, resumeToken: identifier(value.resumeToken) };
    case "sessions-ended":
      return { type: kind, version, sessionIds: sessionIdList(value.sessionIds) };
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
        ...(kind === "answer" && value.privateNetwork !== undefined
          ? { privateNetwork: flag(value.privateNetwork) }
          : {}),
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
    case "webhook-delivery": {
      if (value.format !== undefined && value.format !== STANDARD_WEBHOOKS_FORMAT) invalid();
      const standard = value.format === STANDARD_WEBHOOKS_FORMAT;
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        routeId: matching(value.routeId, WEBHOOK_ROUTE_ID_PATTERN),
        timestamp: matching(value.timestamp, WEBHOOK_TIMESTAMP_PATTERN),
        deliveryId: matching(value.deliveryId, WEBHOOK_DELIVERY_ID_PATTERN),
        signature: matching(value.signature, standard ? STANDARD_WEBHOOK_SIGNATURE_PATTERN : WEBHOOK_SIGNATURE_PATTERN),
        bodyBase64: deliveryBody(value.bodyBase64, WEBHOOK_DELIVERY_BODY_BYTES_LIMIT),
        ...(standard ? { format: STANDARD_WEBHOOKS_FORMAT } : {}),
      };
    }
    case "discord-session":
      return { type: kind, version, token: identifier(value.token), guilds: guildList(value.guilds) };
    case "webhook-ready":
    case "github-ready":
      return { type: kind, version };
    case "ingress-routes-result":
      return { type: kind, version, requestId: identifier(value.requestId), status: ingressRoutesStatus(value.status) };
    case "github-delivery":
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        event: matching(value.event, GITHUB_EVENT_PATTERN),
        deliveryId: matching(value.deliveryId, GITHUB_DELIVERY_ID_PATTERN),
        bodyBase64: deliveryBody(value.bodyBase64, GITHUB_DELIVERY_BODY_BYTES_LIMIT),
      };
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
    case "watch-delivery": {
      const request = decodeWatchRelayHttpRequest({ v: 1, ts: value.ts, sealed: value.sealed, proof: value.proof });
      const ticket = text(value.ticket);
      if (!request || ticket.length === 0 || ticket.length > 8_192) invalid();
      return {
        type: kind,
        version,
        requestId: identifier(value.requestId),
        ticket,
        ts: request.ts,
        proof: request.proof,
        sealed: request.sealed,
      };
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

function identifier(value: unknown): string {
  const candidate = text(value);
  if (candidate.length === 0) invalid();
  return candidate;
}

function integer(value: unknown): number {
  if (!isNumber(value) || !Number.isInteger(value)) invalid();
  return value;
}

function timestamp(value: unknown): number {
  const candidate = integer(value);
  if (candidate <= 0) invalid();
  return candidate;
}

function mLineIndex(value: unknown): number {
  const candidate = integer(value);
  if (candidate < 0) invalid();
  return candidate;
}

function duration(value: unknown): number {
  const candidate = integer(value);
  if (candidate < 0 || candidate > 86_400_000) invalid();
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

function sessionIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > SIGNAL_SESSIONS_ENDED_LIMIT) invalid();
  return value.map(identifier);
}

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

function ingressRoutesStatus(value: unknown): IngressRoutesStatus {
  const status = INGRESS_ROUTES_STATUSES.find((entry) => entry === value);
  if (!status) invalid();
  return status;
}
