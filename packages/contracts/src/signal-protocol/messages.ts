import type { DiscordDelivery } from "./discord-api";
import type { GitHubDeliveryStatus } from "./github-route";
import type { TelegramCallFailure, TelegramCallMethod, TelegramCallParams, TelegramCallResult } from "./telegram-route";
import type { RemoteMemberRole } from "./ticket";
import type { WebhookSignatureFormat } from "./webhook-route";

export const SIGNAL_PROTOCOL_VERSION = 1;
export type SignalProtocolVersion = typeof SIGNAL_PROTOCOL_VERSION;

export const SIGNAL_MESSAGE_BYTES_LIMIT = 64 * 1024;

export const SIGNAL_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

export const SIGNAL_TURN_REFRESH_INTERVAL_MS = Math.floor(SIGNAL_TURN_CREDENTIAL_TTL_SECONDS * 0.75) * 1_000;

export const SIGNAL_DEFAULT_RECONNECT_GRACE_MS = 30_000;
export const SIGNAL_CLIENT_RECONNECT_GRACE_MS = 10 * 60_000;

export const SIGNAL_NO_READY_CLOSE_CODE = "no-ready";

export type SignalPeer = "host" | "client" | "ingress";

export const SLACK_DELIVERY_BODY_BYTES_LIMIT = 64 * 1024;

export const SLACK_DELIVERY_RESPONSE_BYTES_LIMIT = 4 * 1024;

export const WEBHOOK_DELIVERY_BODY_BYTES_LIMIT = 64 * 1024;

export const QUEUED_DELIVERY_SEALED_LIMIT = 512 * 1024;

export type SlackDeliveryKind = "events" | "interactivity";

export type SlackDeliveryStatus = 200 | 400 | 401 | 404 | 503;

export type WebhookDeliveryStatus = 200 | 202 | 400 | 401 | 404 | 413 | 429 | 503;

export type SignalChannel = "team" | "remote-desktop";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const SIGNAL_ERROR_CODES = [
  "authentication_required",
  "invalid_message",
  "host_unavailable",
  "host_busy",
  "permission_denied",
  "rate_limited",
  "session_revoked",
  "protocol_error",
] as const;

export type SignalErrorCode = (typeof SIGNAL_ERROR_CODES)[number];

export type SignalRelayMessage =
  | {
      type: "offer" | "answer";
      version: SignalProtocolVersion;
      connectionId: string;
      channel: SignalChannel;
      sdp: string;
    }
  | {
      type: "ice-candidate";
      version: SignalProtocolVersion;
      connectionId: string;
      channel: SignalChannel;
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }
  | { type: "ice-restart"; version: SignalProtocolVersion; connectionId: string; channel: SignalChannel }
  | { type: "turn-refresh"; version: SignalProtocolVersion; connectionId: string | null }
  | { type: "disconnect"; version: SignalProtocolVersion; connectionId: string };

export type SignalClientMessage =
  | {
      type: "hello";
      version: SignalProtocolVersion;
      peer: SignalPeer;
      token: string;
      multiplex?: boolean;
      waitForHost?: boolean;
      slackRoute?: string;
      discordRoute?: string;
      webhookRoute?: string;
      githubRoute?: string;
      telegramRoute?: string;
      queueKey?: string;
      webhookFormats?: string[];
    }
  | {
      type: "telegram-call";
      version: SignalProtocolVersion;
      requestId: string;
      botId: string;
      method: TelegramCallMethod;
      params: TelegramCallParams[TelegramCallMethod];
    }
  | {
      type: "slack-delivery-result";
      version: SignalProtocolVersion;
      requestId: string;
      status: SlackDeliveryStatus;
      contentType?: "application/json" | "text/plain";
      body?: string;
    }
  | { type: "queued-delivery-ack"; version: SignalProtocolVersion; id: string }
  | {
      type: "webhook-delivery-result";
      version: SignalProtocolVersion;
      requestId: string;
      status: WebhookDeliveryStatus;
    }
  | {
      type: "github-delivery-result";
      version: SignalProtocolVersion;
      requestId: string;
      status: GitHubDeliveryStatus;
    }
  | SignalRelayMessage;

export type SignalServerMessage =
  | { type: "account-profile-changed"; version: SignalProtocolVersion }
  | { type: "account-servers-changed"; version: SignalProtocolVersion }
  | {
      type: "ready";
      version: SignalProtocolVersion;
      connectionId: string | null;
      resumeToken: string;
      iceServers: IceServer[];
      capabilities?: string[];
      reconnectGraceMs?: number;
    }
  | { type: "host-waiting"; version: SignalProtocolVersion; resumeToken: string }
  | {
      type: "peer-ready";
      version: SignalProtocolVersion;
      connectionId: string;
      sessionId: string;
      userId: string;
      membershipId: string;
      role: RemoteMemberRole;
      sessionExpiresAt: number;
      resumed: boolean;
    }
  | { type: "error"; version: SignalProtocolVersion; code: string; message: string; connectionId?: string }
  | {
      type: "slack-delivery";
      version: SignalProtocolVersion;
      requestId: string;
      teamId: string;
      kind: SlackDeliveryKind;
      retryNum: number | null;
      retryReason: string | null;
      bodyBase64: string;
    }
  | {
      type: "telegram-delivery";
      version: SignalProtocolVersion;
      botId: string;
      chatId: string;
      bodyBase64: string;
      linked?: true;
    }
  | ({
      type: "telegram-call-result";
      version: SignalProtocolVersion;
      requestId: string;
    } & ({ ok: true; result: TelegramCallResult } | ({ ok: false } & TelegramCallFailure)))
  | { type: "discord-session"; version: SignalProtocolVersion; token: string; guilds: string[] }
  | { type: "webhook-ready"; version: SignalProtocolVersion }
  | { type: "github-ready"; version: SignalProtocolVersion }
  | {
      type: "github-delivery";
      version: SignalProtocolVersion;
      requestId: string;
      event: string;
      deliveryId: string;
      bodyBase64: string;
    }
  | { type: "discord-delivery"; version: SignalProtocolVersion; guildId: string; delivery: DiscordDelivery }
  | { type: "queued-delivery"; version: SignalProtocolVersion; id: string; sealed: string }
  | {
      type: "webhook-delivery";
      version: SignalProtocolVersion;
      requestId: string;
      routeId: string;
      timestamp: string;
      deliveryId: string;
      signature: string;
      bodyBase64: string;
      format?: WebhookSignatureFormat;
    }
  | SignalRelayMessage;
