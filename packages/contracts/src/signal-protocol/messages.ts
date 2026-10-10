// The Signal wire protocol: the frames a peer and the Signal service exchange over `WSS /v1/signal`.
//
// Signal (`remote/api`) relays SDP and ICE between a host and its clients and hands out resume
// tokens and TURN credentials. Team chats, files and commands never pass through it - those travel
// on the WebRTC data channels it helped negotiate, and their protocol is `../team-protocol` instead.
// The one exception is Slack: the OpenBot Slack app posts every workspace's events to Signal.
// Signal checks the Slack signature, reads only the workspace ID, and passes the request body to
// the `ingress` socket of the host that the workspace is linked to, without storing or logging it.
// Discord is the second: Signal holds the OpenBot Discord bot's Gateway connection, passes each
// guild's mentions of OpenBot to the guild's host, and makes the host's Discord calls
// (`./discord-api.ts`).
// Telegram is the third: the OpenBot bot's updates come to Signal, which passes each to the host of
// its chat, and the host calls the Bot API through Signal, which holds the token (`./telegram-route.ts`).
//
// Three parties speak this and none of them ships together: the service
// (`remote/api/src/signal-service.ts`), the shared client that mobile and the future web client run
// (`packages/team-client/src/remote-peer.ts`), and the desktop's hidden-window peer
// (`src/renderer/src/features/team/team-webrtc.ts`). Each wrote these shapes out by hand, and the
// desktop's copies had degraded into a flat `.loose()` bag of optionals: `sdp`, `candidate` and
// `resumeToken` were `string | undefined` on every branch, so the compiler could not tell a `ready`
// from an `ice-candidate` and every field had to be re-checked at the point of use.
//
// Types and constants only, so a client pays nothing at runtime to import them. Validation is one
// implementation per trust direction and is deliberately not shared: `remote/api` keeps its zod
// schema for the untrusted *client* input it accepts - byte limits, identifier patterns, a closed
// discriminated union - and `./decode.ts` carries the guards a client runs over the *service's*
// output. Neither is the other's mirror, and neither should grow into it.
//
// Unlike `../team-protocol` there are no frozen per-version artifacts here, because this protocol
// has only ever had one version. `version` on these frames is the socket protocol; the app protocol
// negotiated on the data channels is a different number entirely.

import type { DiscordDelivery } from "./discord-api";
import type { TelegramCallFailure, TelegramCallMethod, TelegramCallParams, TelegramCallResult } from "./telegram-route";
import type { RemoteMemberRole } from "./ticket";

export const SIGNAL_PROTOCOL_VERSION = 1;
export type SignalProtocolVersion = typeof SIGNAL_PROTOCOL_VERSION;

// Signal rejects a frame larger than this before it parses it.
export const SIGNAL_MESSAGE_BYTES_LIMIT = 64 * 1024;

// How long the TURN credentials Signal hands out stay usable. `remote/api` mints them for exactly
// this, capped by the session's own expiry.
export const SIGNAL_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

// When a connected peer should ask for replacements: three quarters of the way through, leaving a
// quarter of an hour to retry a refresh that throws or lands on a socket that is reconnecting.
// Derived from the TTL rather than restated beside it because the service and both clients each
// held their own copy of this relationship and nothing linked them - shortening the service's TTL
// would have left both peers refreshing on the old schedule with credentials that had already
// expired, and a peer only notices that when it needs the relay, so the connection would have kept
// working for everyone except the users behind a symmetric NAT.
export const SIGNAL_TURN_REFRESH_INTERVAL_MS = Math.floor(SIGNAL_TURN_CREDENTIAL_TTL_SECONDS * 0.75) * 1_000;

// Which side of the relay a socket is. Only a host may set `multiplex`. An `ingress` socket belongs
// to a host too, but it only receives Slack and Discord deliveries: Signal never attaches a client
// to it, so it can stay open while the host is not published.
export type SignalPeer = "host" | "client" | "ingress";

// The largest Slack request body Signal passes to a host. Signal refuses a larger one with 413.
export const SLACK_DELIVERY_BODY_BYTES_LIMIT = 64 * 1024;

// The largest response body a host returns for a Slack request: a `url_verification` challenge or
// an interactivity reply.
export const SLACK_DELIVERY_RESPONSE_BYTES_LIMIT = 4 * 1024;

// The largest generic webhook body Signal passes to a host. Signal does not inspect or retain it.
export const WEBHOOK_DELIVERY_BODY_BYTES_LIMIT = 64 * 1024;

// The Slack request that a delivery carries. Slack sends events as JSON and button presses as a form.
export type SlackDeliveryKind = "events" | "interactivity";

export type SlackDeliveryStatus = 200 | 400 | 401 | 404 | 503;

export type WebhookDeliveryStatus = 200 | 202 | 400 | 401 | 404 | 413 | 429 | 503;

// Which negotiation a relayed frame belongs to. One socket carries both.
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

// What the service emits. A client must not narrow an incoming code to this - see the `error` frame.
export type SignalErrorCode = (typeof SIGNAL_ERROR_CODES)[number];

// The frames Signal passes through untouched: whatever one peer sends, the other receives exactly
// this. Both unions below include them, which is why they are named once.
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
  // A null `connectionId` asks for the socket's own credentials rather than one connection's.
  | { type: "turn-refresh"; version: SignalProtocolVersion; connectionId: string | null }
  | { type: "disconnect"; version: SignalProtocolVersion; connectionId: string };

export type SignalClientMessage =
  | {
      type: "hello";
      version: SignalProtocolVersion;
      peer: SignalPeer;
      // A remote ticket on the first connect, a resume token on every reconnect after it.
      token: string;
      multiplex?: boolean;
      // `client` only, and optional: when the host is offline, keep this socket open and send
      // `host-waiting` instead of the `host_unavailable` error. An older Signal ignores it and fails
      // the hello as before.
      waitForHost?: boolean;
      // `ingress` only: the Slack route ticket (`./slack-route.ts`) that names the Slack workspaces
      // whose requests this socket receives.
      slackRoute?: string;
      // `ingress` only: the Discord route ticket (`./discord-route.ts`) that names the Discord guilds
      // whose events this socket receives. An `ingress` socket has a Slack route, a Discord route or
      // both.
      discordRoute?: string;
      // `ingress` only: the generic webhook route ticket (`./webhook-route.ts`) that names the
      // opaque webhook routes whose requests this socket receives.
      webhookRoute?: string;
      // `ingress` only, and optional: the Telegram route ticket (`./telegram-route.ts`) that names
      // the Telegram chats whose updates this socket receives.
      telegramRoute?: string;
    }
  // An `ingress` socket's Bot API call, sent only to a Signal whose `ready` named the `telegram`
  // capability. Signal answers with one `telegram-call-result` of the same `requestId`.
  | {
      type: "telegram-call";
      version: SignalProtocolVersion;
      requestId: string;
      // The production and development bots can share a chat, so a call names its bot.
      botId: string;
      method: TelegramCallMethod;
      params: TelegramCallParams[TelegramCallMethod];
    }
  // An `ingress` socket's answer to one `slack-delivery`. Signal returns it to Slack as the HTTP
  // response, so `body` is only the `url_verification` challenge or an interactivity reply.
  | {
      type: "slack-delivery-result";
      version: SignalProtocolVersion;
      requestId: string;
      status: SlackDeliveryStatus;
      contentType?: "application/json" | "text/plain";
      body?: string;
    }
  // An ingress socket's answer to one generic webhook delivery. Signal returns this status to the
  // public webhook caller only after the host has committed the event.
  | {
      type: "webhook-delivery-result";
      version: SignalProtocolVersion;
      requestId: string;
      status: WebhookDeliveryStatus;
    }
  | SignalRelayMessage;

export type SignalServerMessage =
  | { type: "account-profile-changed"; version: SignalProtocolVersion }
  // The account's server list changed: a membership this user accepted, or one that was revoked.
  // Sent to every socket that peer's account holds, which is how a server joined on the desktop
  // reaches the phone paired with it without either of them polling the account service.
  | { type: "account-servers-changed"; version: SignalProtocolVersion }
  | {
      type: "ready";
      version: SignalProtocolVersion;
      connectionId: string | null;
      resumeToken: string;
      iceServers: IceServer[];
      // `ingress` only, and optional: what this Signal can do beyond Slack, such as `telegram`. An
      // older Signal sends none.
      capabilities?: string[];
    }
  // Answers a client hello with `waitForHost` while its host is offline. The socket stays open, and
  // Signal sends `ready` on it when the host connects. `resumeToken` lets the client renew the socket
  // without a new ticket.
  | { type: "host-waiting"; version: SignalProtocolVersion; resumeToken: string }
  // A client attached to a multiplexing host. `resumed` distinguishes a reconnect of a session the
  // host already has from a new one it must set up from scratch.
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
  // `code` is `string` rather than `SignalErrorCode` on purpose: a client decodes this from a
  // service it does not ship with, and a code a newer Signal has added is still a code it has to
  // surface. The service narrows its own emissions where it builds the frame.
  | { type: "error"; version: SignalProtocolVersion; code: string; message: string; connectionId?: string }
  // One Slack request for a workspace linked to this host, sent only to an `ingress` socket. Signal
  // has already checked Slack's signature with the app's signing secret, which no host has. The body
  // is base64 because Slack sends button presses as a form.
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
  // One Telegram update for a chat routed to this host, sent only to an `ingress` socket. Signal has
  // checked Telegram's secret header, which no host has. It needs no answer: Telegram does not send
  // an update again, so a host that is offline loses it.
  | {
      type: "telegram-delivery";
      version: SignalProtocolVersion;
      botId: string;
      chatId: string;
      bodyBase64: string;
      // Only on the `/start <code>` update that the account service just linked to this host. A host
      // links a chat only on this flag: anyone in a routed chat can send a `/start` with any code.
      linked?: true;
    }
  // The answer to one `telegram-call`.
  | ({
      type: "telegram-call-result";
      version: SignalProtocolVersion;
      requestId: string;
    } & ({ ok: true; result: TelegramCallResult } | ({ ok: false } & TelegramCallFailure)))
  // Sent to an `ingress` socket with a Discord route, after `ready`. The host sends `token` as the
  // bearer of its calls to `DISCORD_API_PATH`. It is valid while this socket is open. `guilds` are
  // the guilds routed to this socket: a guild of the host that is not in it was unlinked, or the bot
  // left it.
  | { type: "discord-session"; version: SignalProtocolVersion; token: string; guilds: string[] }
  // Sent after `ready` when the ingress hello carried a webhook route ticket. An older Signal
  // service ignores the optional hello field and never emits this frame, so the host can gate the
  // webhook feature on this acknowledgement.
  | { type: "webhook-ready"; version: SignalProtocolVersion }
  // One Discord event of a guild routed to this `ingress` socket. Signal already acknowledged a button
  // press to Discord; nothing is answered.
  | { type: "discord-delivery"; version: SignalProtocolVersion; guildId: string; delivery: DiscordDelivery }
  // One generic webhook request for a route linked to this host. The HMAC is checked by the host:
  // Signal forwards the exact body and the three signed header values without reading the body.
  | {
      type: "webhook-delivery";
      version: SignalProtocolVersion;
      requestId: string;
      routeId: string;
      timestamp: string;
      deliveryId: string;
      signature: string;
      bodyBase64: string;
    }
  | SignalRelayMessage;
