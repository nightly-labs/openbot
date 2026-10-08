import { createHash, randomBytes } from "node:crypto";
import type { DiscordDelivery } from "@openbot/contracts/signal-protocol/discord-api";
import { DISCORD_ROUTE_TTL_SECONDS, type DiscordRouteGuild } from "@openbot/contracts/signal-protocol/discord-route";
import { SLACK_ROUTE_TTL_SECONDS, type SlackRouteTeam } from "@openbot/contracts/signal-protocol/slack-route";
import { WEBHOOK_ROUTE_TTL_SECONDS, type WebhookRoute } from "@openbot/contracts/signal-protocol/webhook-route";
import { Context, Effect, Layer, Result } from "effect";
import {
  decodeSignalClientMessage,
  encodeSignalServerMessage,
  type IceServer,
  type RemoteTicketClaims,
  SIGNAL_MESSAGE_BYTES_LIMIT,
  type SignalClientMessage,
  type SignalErrorCode,
  type SignalServerMessage,
  type SlackDeliveryKind,
  type SlackDeliveryStatus,
  type WebhookDeliveryStatus,
} from "./protocol";
import { RemoteTokenError } from "./tokens";

/** The workspaces a verified route ticket names, each with the time it was linked to the host. */
interface SlackRoute {
  teams: SlackRouteTeam[];
}

/** The guilds a verified Discord route ticket names, each with the time it was linked to the host. */
interface DiscordRoute {
  guilds: DiscordRouteGuild[];
}

interface WebhookRouteTicket {
  routes: WebhookRoute[];
}

export interface RemoteTokenProvider {
  verifyTicket(token: string): Effect.Effect<RemoteTicketClaims, RemoteTokenError>;
  verifyResumeToken(token: string): Effect.Effect<RemoteTicketClaims, RemoteTokenError>;
  validateClaims(claims: RemoteTicketClaims): Effect.Effect<boolean, RemoteTokenError>;
  issueResumeToken(claims: RemoteTicketClaims): Effect.Effect<string, RemoteTokenError>;
  iceServers(claims: RemoteTicketClaims): IceServer[];
  /** Without a route verifier, no ingress socket connects. */
  verifySlackRoute?(token: string, hostId: string): Effect.Effect<SlackRoute, RemoteTokenError>;
  validateSlackRoute?(hostId: string, teams: SlackRouteTeam[]): Effect.Effect<string[], RemoteTokenError>;
  /** Without a Discord route verifier, an ingress socket cannot name Discord guilds. */
  verifyDiscordRoute?(token: string, hostId: string): Effect.Effect<DiscordRoute, RemoteTokenError>;
  validateDiscordRoute?(hostId: string, guilds: DiscordRouteGuild[]): Effect.Effect<string[], RemoteTokenError>;
  /** Without a route verifier, an ingress socket cannot name generic webhook routes. */
  verifyWebhookRoute?(token: string, hostId: string): Effect.Effect<WebhookRouteTicket, RemoteTokenError>;
  validateWebhookRoute?(hostId: string, routes: WebhookRoute[]): Effect.Effect<string[], RemoteTokenError>;
  revokeHost?(hostId: string, authEpoch: number): void;
  revokeSession?(sessionId: string): void;
}

export class SignalTokens extends Context.Service<SignalTokens, RemoteTokenProvider>()(
  "@openbot/remote-api/SignalTokens",
) {
  static layer(provider: RemoteTokenProvider) {
    return Layer.succeed(SignalTokens, provider);
  }
}

export interface SignalSocket {
  id: string;
  ip: string;
  send(message: string): void;
  close(code: number, reason: string): void;
}

interface AuthenticatedPeer {
  socket: SignalSocket;
  claims: RemoteTicketClaims;
  peer: "host" | "client" | "ingress";
  connectionId: string | null;
  resumed: boolean;
  multiplex: boolean;
  // `ingress` only: the Slack workspaces whose requests this socket receives.
  // The routes this socket holds: `<app ID>:<workspace ID>`.
  slackTeams: string[];
  // `ingress` only: the Discord guild IDs whose events this socket receives.
  discordGuilds: string[];
  // `ingress` only: the hash of the `discord-session` token sent to this socket.
  discordSession: string | null;
  // `ingress` only: opaque generic webhook route IDs whose requests this socket receives.
  webhookRoutes: string[];
}

interface ActiveConnection {
  id: string;
  hostId: string;
  sessionId: string;
  client: SignalSocket;
  host: SignalSocket;
}

export interface SignalMetrics {
  acceptedConnections: number;
  authenticationFailures: number;
  protocolFailures: number;
  relayedMessages: number;
  activeSockets: number;
  activePeerConnections: number;
  slackDeliveries: number;
  slackDeliveriesUnavailable: number;
  discordDeliveries: number;
  // No socket holds the guild, or the delivery is larger than a Signal message.
  discordDeliveriesUnavailable: number;
  discordApiCalls: number;
  discordApiFailures: number;
  webhookDeliveries: number;
  webhookDeliveriesUnavailable: number;
}

/** The result of the authorization of one Discord API call. */
export type DiscordCaller = { ok: true; hostId: string } | { ok: false; code: "unauthorized" | "unknown_guild" };

export interface SignalServiceOptions {
  /** Signal holds the Discord bot token: an `ingress` socket with a Discord route gets a session. */
  discord?: boolean;
}

/** What the Discord Gateway knows of the bot's guilds. */
export interface DiscordMembership {
  /** Whether the bot is in the guild, or null before the Gateway has listed its guilds. */
  isMember(guildId: string): boolean | null;
  /** A route ticket names a guild that the bot left: the account service unlinks it. */
  left(guildId: string): void;
}

/** One signed Slack request for a workspace. Signal passes it on and keeps nothing of it. */
export interface SlackDelivery {
  kind: SlackDeliveryKind;
  retryNum: number | null;
  retryReason: string | null;
  body: Uint8Array;
}

export interface SlackDeliveryResponse {
  status: SlackDeliveryStatus;
  contentType?: "application/json" | "text/plain";
  body?: string;
}

export interface WebhookDelivery {
  timestamp: string;
  deliveryId: string;
  signature: string;
  body: Uint8Array;
}

export interface WebhookDeliveryResponse {
  status: WebhookDeliveryStatus;
}

type IngressDeliveryKind = "slack" | "webhook";

type IngressDeliveryResult = Extract<SignalClientMessage, { type: `${IngressDeliveryKind}-delivery-result` }>;

/** One Slack or webhook request that waits for the answer of an `ingress` socket. */
interface PendingDelivery {
  kind: IngressDeliveryKind;
  socketId: string;
  hostId: string;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
  /** Null when the host gave no answer: its socket closed or the wait timed out. */
  resolve(result: IngressDeliveryResult | null): void;
}

export interface IngressDeliveryLimits {
  /** How long Signal waits for the host. Slack gives up after 3 seconds. */
  timeoutMilliseconds: number;
  maximumPendingPerHost: number;
  maximumPendingBytesPerHost: number;
  maximumPending: number;
}

/**
 * Slack and webhook deliveries share these limits, so the bytes in flight to one host stay under the
 * socket's 256 KB backpressure limit, which closes the socket when it is reached. A body travels as
 * base64, a third larger than the body. The remainder leaves room for frame fields and Discord events.
 */
const DEFAULT_INGRESS_DELIVERY_LIMITS: IngressDeliveryLimits = {
  timeoutMilliseconds: 2_500,
  maximumPendingPerHost: 16,
  maximumPendingBytesPerHost: 128 * 1024,
  maximumPending: 1_000,
};

const UNAVAILABLE = { status: 503 } as const;

const MAXIMUM_RATE_WINDOWS = 100_000;
const RATE_WINDOW_MILLISECONDS = 60_000;
const SIGNAL_RECONNECT_GRACE_MILLISECONDS = 30_000;
const INITIAL_TICKET_TTL_MILLISECONDS = 3 * 60_000;
const MAXIMUM_EXPIRATION_TIMER_MILLISECONDS = 24 * 60 * 60_000;
const INGRESS_RATE_FACTOR = 10;
// Slack sends at most 30,000 events an hour for one app in one workspace.
const SLACK_TEAM_RATE_FACTOR = 2;
const DISCORD_SESSION_TOKEN_BYTES = 32;
// How long after a link Signal waits for the Gateway to report the bot in the guild.
const DISCORD_NEW_LINK_MILLISECONDS = 5 * 60_000;

export class SignalService {
  readonly #tokens: RemoteTokenProvider;
  readonly #maximumConnectionsPerUser: number;
  readonly #maximumConnectionsPerIp: number;
  readonly #maximumMessagesPerMinute: number;
  readonly #sockets = new Map<string, SignalSocket>();
  readonly #peers = new Map<string, AuthenticatedPeer>();
  readonly #hosts = new Map<string, Set<string>>();
  // Slack workspace ID to the `ingress` socket that said hello last with a route ticket for it.
  readonly #slackTeams = new Map<string, string>();
  // The oldest link that each workspace still accepts: the link of its current route, or the moment
  // after the account service revoked it. A host that lost a workspace keeps its last ticket until it
  // expires; this keeps that ticket from taking the route back.
  readonly #slackRouteFloor = new Map<string, number>();
  // Discord guild ID to the `ingress` socket that said hello last with a route ticket for it.
  readonly #discordGuilds = new Map<string, string>();
  // The oldest link that each guild still accepts, as `#slackRouteFloor` does for Slack.
  readonly #discordRouteFloor = new Map<string, number>();
  // Generic webhook route ID to the `ingress` socket that said hello last with a route ticket.
  readonly #webhookRoutes = new Map<string, string>();
  readonly #webhookRouteFloor = new Map<string, number>();
  // The SHA-256 of each `discord-session` token to its socket. The token itself is not kept.
  readonly #discordSessions = new Map<string, string>();
  readonly #discordEnabled: boolean;
  #discordMembership: DiscordMembership | null = null;
  readonly #pendingDeliveries = new Map<string, PendingDelivery>();
  readonly #deliveryLimits: IngressDeliveryLimits;
  readonly #connections = new Map<string, ActiveConnection>();
  readonly #connectionDropTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #peerExpirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #usedTicketIds = new Map<string, number>();
  readonly #revokedEpochs = new Map<string, number>();
  readonly #revokedSessions = new Map<string, number>();
  readonly #rateWindows = new Map<string, { startedAt: number; count: number }>();
  readonly #validateInitialTicketsUntil = Date.now() + INITIAL_TICKET_TTL_MILLISECONDS;
  // The revocations below are in memory. Until every route ticket issued before this start has
  // expired, the account service confirms each link.
  readonly #validateSlackRoutesUntil = Date.now() + SLACK_ROUTE_TTL_SECONDS * 1_000;
  readonly #validateDiscordRoutesUntil = Date.now() + DISCORD_ROUTE_TTL_SECONDS * 1_000;
  readonly #validateWebhookRoutesUntil = Date.now() + WEBHOOK_ROUTE_TTL_SECONDS * 1_000;
  #lastRatePruneAt = 0;
  readonly #metrics: SignalMetrics = {
    acceptedConnections: 0,
    authenticationFailures: 0,
    protocolFailures: 0,
    relayedMessages: 0,
    activeSockets: 0,
    activePeerConnections: 0,
    slackDeliveries: 0,
    slackDeliveriesUnavailable: 0,
    discordDeliveries: 0,
    discordDeliveriesUnavailable: 0,
    discordApiCalls: 0,
    discordApiFailures: 0,
    webhookDeliveries: 0,
    webhookDeliveriesUnavailable: 0,
  };

  readonly dependencies: Layer.Layer<SignalTokens>;

  constructor(
    tokens: RemoteTokenProvider,
    maximumConnectionsPerUser: number,
    maximumConnectionsPerIp = 32,
    maximumMessagesPerMinute = 600,
    deliveryLimits: IngressDeliveryLimits = DEFAULT_INGRESS_DELIVERY_LIMITS,
    options: SignalServiceOptions = {},
  ) {
    this.#tokens = tokens;
    this.dependencies = SignalTokens.layer(tokens);
    this.#maximumConnectionsPerUser = maximumConnectionsPerUser;
    this.#maximumConnectionsPerIp = maximumConnectionsPerIp;
    this.#maximumMessagesPerMinute = maximumMessagesPerMinute;
    this.#deliveryLimits = deliveryLimits;
    this.#discordEnabled = options.discord === true;
  }

  close(): void {
    for (const timer of this.#connectionDropTimers.values()) clearTimeout(timer);
    for (const timer of this.#peerExpirationTimers.values()) clearTimeout(timer);
    this.#connectionDropTimers.clear();
    this.#peerExpirationTimers.clear();
    for (const requestId of [...this.#pendingDeliveries.keys()]) this.#settleDelivery(requestId, null);
  }

  connect(socket: SignalSocket): boolean {
    if (this.#sockets.has(socket.id)) return true;
    if (this.#socketIpCount(socket.ip) >= this.#maximumConnectionsPerIp) {
      this.#fail(socket, "rate_limited", "Too many remote connections from this address.", 1008);
      return false;
    }
    this.#sockets.set(socket.id, socket);
    this.#metrics.activeSockets = this.#sockets.size;
    return true;
  }

  readonly receive = Effect.fn("Signal.receive")((socket: SignalSocket, input: string | Uint8Array) =>
    Effect.gen({ self: this }, function* () {
      const tokens = yield* SignalTokens;
      if (!this.#acceptMessage(socket)) {
        this.#fail(socket, "rate_limited", "Too many signal messages.", 1008);
        return;
      }
      const text = input instanceof Uint8Array ? new TextDecoder().decode(input) : input;
      if (new TextEncoder().encode(text).byteLength > SIGNAL_MESSAGE_BYTES_LIMIT) {
        this.#fail(socket, "invalid_message", "Signal message is too large.", 1009);
        return;
      }
      let message: SignalClientMessage;
      try {
        message = decodeSignalClientMessage(JSON.parse(text));
      } catch {
        this.#metrics.protocolFailures += 1;
        this.#fail(socket, "invalid_message", "Signal message is invalid.", 1003);
        return;
      }
      if (message.type === "hello") {
        yield* this.#authenticate(socket, message);
        return;
      }
      const peer = this.#peers.get(socket.id);
      if (!peer) {
        this.#fail(socket, "authentication_required", "Authenticate before sending signal messages.", 1008);
        return;
      }
      if (message.type === "turn-refresh") {
        if (peer.claims.sessionExpiresAt <= Math.floor(Date.now() / 1_000)) {
          this.#fail(socket, "authentication_required", "The remote session expired.", 1008);
          return;
        }
        if (message.connectionId !== null && !this.#ownsConnection(peer, message.connectionId)) {
          this.#fail(socket, "permission_denied", "The connection does not belong to this peer.");
          return;
        }
        this.#send(socket, {
          type: "ready",
          version: 1,
          connectionId: message.connectionId,
          resumeToken: yield* tokens.issueResumeToken(peer.claims),
          iceServers: this.#tokens.iceServers(peer.claims),
        });
        return;
      }
      if (message.type === "disconnect") {
        if (this.#ownsConnection(peer, message.connectionId)) this.#dropConnection(message.connectionId, socket.id);
        return;
      }
      if (message.type === "slack-delivery-result" || message.type === "webhook-delivery-result") {
        const pending = this.#pendingDeliveries.get(message.requestId);
        if (!pending || pending.socketId !== socket.id || `${pending.kind}-delivery-result` !== message.type) {
          this.#fail(socket, "permission_denied", "The delivery does not belong to this peer.");
          return;
        }
        this.#settleDelivery(message.requestId, message);
        return;
      }
      const connection = this.#connections.get(message.connectionId);
      if (!connection || (connection.client.id !== socket.id && connection.host.id !== socket.id)) {
        this.#fail(socket, "permission_denied", "The connection does not belong to this peer.");
        return;
      }
      const target = connection.client.id === socket.id ? connection.host : connection.client;
      this.#send(target, message);
      this.#metrics.relayedMessages += 1;
    }),
  );

  readonly disconnect = Effect.fn("Signal.disconnect")((socket: SignalSocket) =>
    Effect.gen({ self: this }, function* () {
      this.#sockets.delete(socket.id);
      const peer = this.#peers.get(socket.id);
      this.#clearPeerExpiration(socket.id);
      if (!peer) {
        this.#metrics.activeSockets = this.#sockets.size;
        return;
      }
      this.#peers.delete(socket.id);
      if (peer.peer === "host") {
        const hostSockets = this.#hosts.get(peer.claims.hostId);
        hostSockets?.delete(socket.id);
        if (hostSockets?.size === 0) this.#hosts.delete(peer.claims.hostId);
      }
      if (peer.peer === "ingress") {
        for (const route of peer.slackTeams) {
          if (this.#slackTeams.get(route) === socket.id) this.#slackTeams.delete(route);
        }
        for (const [requestId, pending] of [...this.#pendingDeliveries]) {
          if (pending.socketId === socket.id) this.#settleDelivery(requestId, null);
        }
        for (const route of peer.webhookRoutes) {
          if (this.#webhookRoutes.get(route) === socket.id) this.#webhookRoutes.delete(route);
        }
        for (const guildId of peer.discordGuilds) {
          if (this.#discordGuilds.get(guildId) === socket.id) this.#discordGuilds.delete(guildId);
        }
        if (peer.discordSession) this.#discordSessions.delete(peer.discordSession);
      }
      for (const connection of [...this.#connections.values()]) {
        if (connection.client.id !== socket.id && connection.host.id !== socket.id) continue;
        if (connection.client.id === socket.id) {
          this.#scheduleConnectionDrop(connection);
          continue;
        }
        this.#clearConnectionDrop(connection.id);
        this.#connections.delete(connection.id);
        const clientPeer = this.#peers.get(connection.client.id);
        if (clientPeer) clientPeer.connectionId = null;
      }
      this.#metrics.activePeerConnections = this.#connections.size;
      this.#metrics.activeSockets = this.#sockets.size;
      if (peer.peer === "host") {
        const replacement = this.#currentHost(peer.claims.hostId);
        if (replacement) yield* this.#restoreWaitingClients(replacement);
      }
    }),
  );

  profileChanged(userId: string): void {
    this.#notifyAccount(userId, "account-profile-changed");
  }

  /**
   * A membership this account accepted or lost. Every socket the account holds is told, because
   * the device that made the change is not the one that needs to hear about it: the desktop and
   * the phone signed in to one account each keep their own server list.
   */
  serversChanged(userId: string): void {
    this.#notifyAccount(userId, "account-servers-changed");
  }

  #notifyAccount(userId: string, type: "account-profile-changed" | "account-servers-changed"): void {
    for (const peer of this.#peers.values()) {
      if (peer.claims.userId === userId) this.#send(peer.socket, { type, version: 1 });
    }
  }

  revoke(hostId: string, authEpoch: number): void {
    const current = this.#revokedEpochs.get(hostId) ?? 0;
    if (authEpoch <= current) return;
    this.#revokedEpochs.set(hostId, authEpoch);
    this.#tokens.revokeHost?.(hostId, authEpoch);
    for (const connection of [...this.#connections.values()]) {
      const host = this.#peers.get(connection.host.id);
      if (connection.hostId === hostId && host && host.claims.authEpoch < authEpoch) {
        this.#dropConnection(connection.id, connection.client.id);
      }
    }
    for (const peer of [...this.#peers.values()]) {
      if (peer.claims.hostId !== hostId || peer.claims.authEpoch >= authEpoch) continue;
      if (peer.connectionId) this.#dropConnection(peer.connectionId, peer.socket.id);
      this.#fail(peer.socket, "session_revoked", "Remote access was revoked.", 1008);
    }
  }

  /** The account service unlinked a Slack workspace, or moved it, after `through`'s link. */
  revokeSlackRoute(appId: string, teamId: string, through: number): void {
    const route = slackRouteKey(appId, teamId);
    const floor = this.#slackRouteFloor.get(route) ?? 0;
    // A newer link already holds the route.
    if (floor > through) return;
    this.#slackRouteFloor.set(route, through + 1);
    this.#slackTeams.delete(route);
  }

  /** Set by the Discord Gateway when it starts, which is after this service. */
  setDiscordMembership(membership: DiscordMembership | null): void {
    this.#discordMembership = membership;
  }

  /** The account service unlinked a Discord guild, or moved it, after `through`'s link. */
  revokeDiscordRoute(guildId: string, through: number): void {
    const floor = this.#discordRouteFloor.get(guildId) ?? 0;
    // A newer link already holds the route.
    if (floor > through) return;
    this.#discordRouteFloor.set(guildId, through + 1);
    this.#discordGuilds.delete(guildId);
  }

  /** The account service disabled, deleted or moved a generic webhook route. */
  revokeWebhookRoute(routeId: string, through: number): void {
    const floor = this.#webhookRouteFloor.get(routeId) ?? 0;
    if (floor > through) return;
    this.#webhookRouteFloor.set(routeId, through + 1);
    this.#webhookRoutes.delete(routeId);
  }

  /**
   * Passes one normalized Discord event to the `ingress` socket of the guild's host. Nothing waits
   * for an answer, and nothing is kept: with no socket for the guild, the event is dropped.
   */
  deliverDiscord(guildId: string, delivery: DiscordDelivery): boolean {
    const socketId = this.#discordGuilds.get(guildId);
    const ingress = socketId ? this.#peers.get(socketId) : undefined;
    const message = ingress
      ? encodeSignalServerMessage({ type: "discord-delivery", version: 1, guildId, delivery })
      : null;
    if (!ingress || !message || new TextEncoder().encode(message).byteLength > SIGNAL_MESSAGE_BYTES_LIMIT) {
      this.#metrics.discordDeliveriesUnavailable += 1;
      return false;
    }
    ingress.socket.send(message);
    this.#metrics.discordDeliveries += 1;
    return true;
  }

  /**
   * Authorizes one Discord API call: the `discord-session` token must belong to an open `ingress`
   * socket, and that socket must hold the guild. With no guild, only the token is checked.
   */
  discordCaller(token: string, guildId: string | null): DiscordCaller {
    const socketId = this.#discordSessions.get(discordSessionKey(token));
    const peer = socketId ? this.#peers.get(socketId) : undefined;
    if (!socketId || !peer) return { ok: false, code: "unauthorized" };
    if (guildId !== null && this.#discordGuilds.get(guildId) !== socketId) return { ok: false, code: "unknown_guild" };
    return { ok: true, hostId: peer.claims.hostId };
  }

  /** The rate limit of the Discord API calls of one host. It returns the wait in milliseconds, or null. */
  acceptDiscordCall(hostId: string, now = Date.now()): number | null {
    const key = `discord-host:${hostId}`;
    if (this.#acceptRateKey(key, now)) return null;
    const window = this.#rateWindows.get(key);
    return window ? Math.max(1, window.startedAt + RATE_WINDOW_MILLISECONDS - now) : RATE_WINDOW_MILLISECONDS;
  }

  /** Applies the generic webhook rate limit by route or source address. */
  acceptWebhookRequest(key: string): boolean {
    return this.#acceptRateKey(`webhook:${key}`, Date.now());
  }

  recordDiscordCall(succeeded: boolean): void {
    this.#metrics.discordApiCalls += 1;
    if (!succeeded) this.#metrics.discordApiFailures += 1;
  }

  revokeSession(sessionId: string): void {
    this.#revokedSessions.set(sessionId, Math.floor(Date.now() / 1_000) + 24 * 60 * 60);
    this.#tokens.revokeSession?.(sessionId);
    for (const connection of [...this.#connections.values()]) {
      if (connection.sessionId === sessionId) this.#dropConnection(connection.id, connection.client.id);
    }
    for (const peer of [...this.#peers.values()]) {
      if (peer.peer === "client" && peer.claims.sessionId === sessionId) {
        if (peer.connectionId) this.#dropConnection(peer.connectionId, peer.socket.id);
        this.#fail(peer.socket, "session_revoked", "The remote session ended.", 1008);
      }
    }
  }

  /**
   * Passes one signed Slack request to the `ingress` socket of the workspace's host and waits for
   * its answer. It resolves 503 when no host holds the workspace, the host is too busy, or it does
   * not answer in time: Slack then sends the request again, so nothing needs to be kept here.
   */
  readonly deliverSlack = Effect.fn("Signal.deliverSlack")((appId: string, teamId: string, delivery: SlackDelivery) =>
    this.#deliver(
      "slack",
      this.#slackTeams.get(slackRouteKey(appId, teamId)),
      delivery.body,
      (requestId, bodyBase64) => ({
        type: "slack-delivery",
        version: 1,
        requestId,
        teamId,
        kind: delivery.kind,
        retryNum: delivery.retryNum,
        retryReason: delivery.retryReason,
        bodyBase64,
      }),
    ).pipe(
      Effect.map(
        (result): SlackDeliveryResponse =>
          result?.type === "slack-delivery-result"
            ? {
                status: result.status,
                ...(result.contentType && result.body !== undefined
                  ? { contentType: result.contentType, body: result.body }
                  : {}),
              }
            : UNAVAILABLE,
      ),
    ),
  );

  /** Whether an open `ingress` socket holds this webhook route. Signal checks it before it reads a body. */
  holdsWebhookRoute(routeId: string): boolean {
    const socketId = this.#webhookRoutes.get(routeId);
    return socketId !== undefined && this.#peers.has(socketId);
  }

  /**
   * Passes one generic webhook to the host and waits for its commit acknowledgement. It resolves 503
   * in the same cases as a Slack delivery.
   */
  readonly deliverWebhook = Effect.fn("Signal.deliverWebhook")((routeId: string, delivery: WebhookDelivery) =>
    this.#deliver("webhook", this.#webhookRoutes.get(routeId), delivery.body, (requestId, bodyBase64) => ({
      type: "webhook-delivery",
      version: 1,
      requestId,
      routeId,
      timestamp: delivery.timestamp,
      deliveryId: delivery.deliveryId,
      signature: delivery.signature,
      bodyBase64,
    })).pipe(
      Effect.map(
        (result): WebhookDeliveryResponse =>
          result?.type === "webhook-delivery-result" ? { status: result.status } : UNAVAILABLE,
      ),
    ),
  );

  /**
   * Sends one Slack or webhook delivery to an `ingress` socket and waits for its answer. It resolves
   * null when no socket holds the route, the host is too busy, or it does not answer in time: the
   * sender then tries again, so nothing needs to be kept here. Both kinds share one budget per host.
   */
  readonly #deliver = Effect.fn("Signal.deliver")(
    (
      kind: IngressDeliveryKind,
      socketId: string | undefined,
      body: Uint8Array,
      frame: (requestId: string, bodyBase64: string) => SignalServerMessage,
    ) =>
      Effect.gen({ self: this }, function* () {
        const ingress = socketId ? this.#peers.get(socketId) : undefined;
        if (!ingress) return this.#undelivered(kind);
        const hostId = ingress.claims.hostId;
        let hostPending = 0;
        let hostBytes = 0;
        for (const pending of this.#pendingDeliveries.values()) {
          if (pending.hostId !== hostId) continue;
          hostPending += 1;
          hostBytes += pending.bytes;
        }
        const bytes = Math.ceil(body.byteLength / 3) * 4;
        if (
          this.#pendingDeliveries.size >= this.#deliveryLimits.maximumPending ||
          hostPending >= this.#deliveryLimits.maximumPendingPerHost ||
          hostBytes + bytes > this.#deliveryLimits.maximumPendingBytesPerHost
        ) {
          return this.#undelivered(kind);
        }
        const requestId = randomIdentifier();
        return yield* Effect.callback<IngressDeliveryResult | null>((resume) => {
          const resolve = (result: IngressDeliveryResult | null) => resume(Effect.succeed(result));
          const timer = setTimeout(
            () => this.#settleDelivery(requestId, null),
            this.#deliveryLimits.timeoutMilliseconds,
          );
          timer.unref?.();
          this.#pendingDeliveries.set(requestId, { kind, socketId: ingress.socket.id, hostId, bytes, timer, resolve });
          this.#metrics[`${kind}Deliveries`] += 1;
          this.#send(ingress.socket, frame(requestId, Buffer.from(body).toString("base64")));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              const pending = this.#pendingDeliveries.get(requestId);
              if (pending) {
                clearTimeout(pending.timer);
                this.#pendingDeliveries.delete(requestId);
              }
            }),
          ),
        );
      }),
  );

  /**
   * The rate limit for the Slack route: by workspace for a signed request, by address for a refused
   * one. A signed request is never limited by address, because Slack sends every app's events from
   * shared addresses.
   */
  acceptSlackRequest(key: `team:${string}` | `address:${string}`): boolean {
    return this.#acceptRateKey(`slack-${key}`, Date.now(), key.startsWith("team:") ? SLACK_TEAM_RATE_FACTOR : 1);
  }

  #settleDelivery(requestId: string, result: IngressDeliveryResult | null): void {
    const pending = this.#pendingDeliveries.get(requestId);
    if (!pending) return;
    this.#pendingDeliveries.delete(requestId);
    clearTimeout(pending.timer);
    if (!result) this.#undelivered(pending.kind);
    pending.resolve(result);
  }

  #undelivered(kind: IngressDeliveryKind): null {
    this.#metrics[`${kind}DeliveriesUnavailable`] += 1;
    return null;
  }

  metrics(): SignalMetrics {
    this.#pruneReplayCache();
    return { ...this.#metrics, activeSockets: this.#sockets.size, activePeerConnections: this.#connections.size };
  }

  readonly #authenticate = Effect.fn("Signal.authenticate")(
    (socket: SignalSocket, message: Extract<SignalClientMessage, { type: "hello" }>) =>
      Effect.gen({ self: this }, function* () {
        if (this.#peers.has(socket.id)) {
          this.#fail(socket, "protocol_error", "This socket is already authenticated.", 1008);
          return;
        }
        const tokens = yield* SignalTokens;
        let usedInitialTicket = true;
        const authentication = yield* Effect.gen({ self: this }, function* () {
          const initial = yield* Effect.gen({ self: this }, function* () {
            const claims = yield* tokens.verifyTicket(message.token);
            if (Date.now() < this.#validateInitialTicketsUntil && !(yield* tokens.validateClaims(claims))) {
              return yield* new RemoteTokenError({ message: "The remote session is not active." });
            }
            return claims;
          }).pipe(Effect.result);
          let claims: RemoteTicketClaims;
          if (Result.isFailure(initial)) {
            usedInitialTicket = false;
            claims = yield* tokens.verifyResumeToken(message.token);
          } else claims = initial.success;
          if ((this.#revokedEpochs.get(claims.hostId) ?? 0) > claims.authEpoch) {
            return yield* new RemoteTokenError({ message: "Revoked ticket." });
          }
          if (claims.role !== "host" && this.#revokedSessions.has(claims.sessionId))
            return yield* new RemoteTokenError({ message: "Ended session." });
          if (message.peer !== "client" && claims.role !== "host")
            return yield* new RemoteTokenError({ message: "Host role required." });
          if (message.peer === "client" && claims.role === "host")
            return yield* new RemoteTokenError({ message: "Member role required." });
          let slackRoute: SlackRoute = { teams: [] };
          let discordRoute: DiscordRoute = { guilds: [] };
          let webhookRoute: WebhookRouteTicket = { routes: [] };
          if (message.peer === "ingress") {
            if (!message.slackRoute && !message.discordRoute && !message.webhookRoute)
              return yield* new RemoteTokenError({ message: "A Slack, Discord or webhook route is required." });
            if (message.slackRoute) {
              if (!tokens.verifySlackRoute) return yield* new RemoteTokenError({ message: "Slack route required." });
              slackRoute = yield* tokens.verifySlackRoute(message.slackRoute, claims.hostId);
              if (Date.now() < this.#validateSlackRoutesUntil) {
                if (!tokens.validateSlackRoute)
                  return yield* new RemoteTokenError({ message: "Slack route validation required." });
                const linked = new Set(yield* tokens.validateSlackRoute(claims.hostId, slackRoute.teams));
                slackRoute = { teams: slackRoute.teams.filter((team) => linked.has(team.id)) };
              }
            }
            if (message.discordRoute) {
              if (!tokens.verifyDiscordRoute)
                return yield* new RemoteTokenError({ message: "Discord route verification required." });
              discordRoute = yield* tokens.verifyDiscordRoute(message.discordRoute, claims.hostId);
              if (Date.now() < this.#validateDiscordRoutesUntil) {
                if (!tokens.validateDiscordRoute)
                  return yield* new RemoteTokenError({ message: "Discord route validation required." });
                const linked = new Set(yield* tokens.validateDiscordRoute(claims.hostId, discordRoute.guilds));
                discordRoute = { guilds: discordRoute.guilds.filter((guild) => linked.has(guild.id)) };
              }
            }
            if (message.webhookRoute) {
              if (!tokens.verifyWebhookRoute)
                return yield* new RemoteTokenError({ message: "Webhook route verification required." });
              webhookRoute = yield* tokens.verifyWebhookRoute(message.webhookRoute, claims.hostId);
              if (Date.now() < this.#validateWebhookRoutesUntil) {
                if (!tokens.validateWebhookRoute)
                  return yield* new RemoteTokenError({ message: "Webhook route validation required." });
                const linked = new Set(yield* tokens.validateWebhookRoute(claims.hostId, webhookRoute.routes));
                webhookRoute = { routes: webhookRoute.routes.filter((route) => linked.has(route.id)) };
              }
            }
          }
          this.#pruneReplayCache();
          if (usedInitialTicket && this.#usedTicketIds.has(claims.jti))
            return yield* new RemoteTokenError({ message: "Ticket was already used." });
          return { claims, slackRoute, discordRoute, webhookRoute };
        }).pipe(Effect.result);
        if (Result.isFailure(authentication)) {
          this.#metrics.authenticationFailures += 1;
          this.#fail(socket, "authentication_required", "Remote ticket is invalid or expired.", 1008);
          return;
        }
        // Verification may finish after disconnect removed the socket. Register nothing then.
        if (!this.#sockets.has(socket.id)) return;
        const { claims, slackRoute, discordRoute, webhookRoute } = authentication.success;
        // A reconnect of the same logical session replaces its old socket below, so that socket does not
        // count. A phone that changes network keeps a half-open socket until the idle timeout.
        const replaced =
          message.peer === "client"
            ? this.#connectionForSession(claims.hostId, claims.sessionId)?.client.id
            : undefined;
        if (
          message.peer !== "ingress" &&
          this.#userConnectionCount(claims.userId, replaced) >= this.#maximumConnectionsPerUser
        ) {
          this.#fail(socket, "rate_limited", "Too many active remote connections.", 1008);
          return;
        }
        if (usedInitialTicket) this.#usedTicketIds.set(claims.jti, claims.exp);
        const peer: AuthenticatedPeer = {
          socket,
          claims,
          peer: message.peer,
          connectionId: null,
          resumed: !usedInitialTicket,
          multiplex: message.peer === "host" && message.multiplex === true,
          slackTeams: slackRoute.teams.map((team) => slackRouteKey(team.appId, team.id)),
          discordGuilds: discordRoute.guilds.map((guild) => guild.id),
          discordSession: null,
          webhookRoutes: webhookRoute.routes.map((route) => route.id),
        };
        this.#peers.set(socket.id, peer);
        this.#schedulePeerExpiration(peer);
        this.#metrics.acceptedConnections += 1;
        this.#metrics.activeSockets = this.#sockets.size;
        const resumeToken = yield* tokens.issueResumeToken(claims);
        // Token signing is asynchronous too. Disconnect already removes the peer and timer.
        if (!this.#sockets.has(socket.id)) return;
        if (message.peer === "ingress") {
          for (const team of slackRoute.teams) {
            const route = slackRouteKey(team.appId, team.id);
            if (team.linkedAt < (this.#slackRouteFloor.get(route) ?? 0)) continue;
            this.#slackRouteFloor.set(route, team.linkedAt);
            this.#slackTeams.set(route, socket.id);
          }
          const heldGuilds: string[] = [];
          for (const guild of discordRoute.guilds) {
            if (guild.linkedAt < (this.#discordRouteFloor.get(guild.id) ?? 0)) continue;
            // The bot left the guild while its unlink did not reach the account service, such as
            // when the host was off and the request failed, or before Signal restarted. A new link
            // can arrive before the Gateway reports that the bot joined, so it is not judged.
            if (
              this.#discordMembership?.isMember(guild.id) === false &&
              Date.now() - guild.linkedAt > DISCORD_NEW_LINK_MILLISECONDS
            ) {
              this.#discordMembership.left(guild.id);
              continue;
            }
            this.#discordRouteFloor.set(guild.id, guild.linkedAt);
            this.#discordGuilds.set(guild.id, socket.id);
            heldGuilds.push(guild.id);
          }
          for (const route of webhookRoute.routes) {
            if (route.linkedAt < (this.#webhookRouteFloor.get(route.id) ?? 0)) continue;
            this.#webhookRouteFloor.set(route.id, route.linkedAt);
            this.#webhookRoutes.set(route.id, socket.id);
          }
          this.#send(socket, {
            type: "ready",
            version: 1,
            connectionId: null,
            resumeToken,
            iceServers: this.#tokens.iceServers(claims),
          });
          if (webhookRoute.routes.length > 0) {
            this.#send(socket, { type: "webhook-ready", version: 1 });
          }
          // Without the bot token, Signal cannot make a Discord call: the socket gets no session. The
          // session names the guilds routed here, so the host learns of a guild it lost while off.
          if (this.#discordEnabled && message.discordRoute) {
            const token = randomBytes(DISCORD_SESSION_TOKEN_BYTES).toString("base64url");
            peer.discordSession = discordSessionKey(token);
            this.#discordSessions.set(peer.discordSession, socket.id);
            this.#send(socket, { type: "discord-session", version: 1, token, guilds: heldGuilds });
          }
          return;
        }
        if (message.peer === "host") {
          const hostSockets = this.#hosts.get(claims.hostId) ?? new Set<string>();
          hostSockets.add(socket.id);
          this.#hosts.set(claims.hostId, hostSockets);
          this.#send(socket, {
            type: "ready",
            version: 1,
            connectionId: null,
            resumeToken,
            iceServers: this.#tokens.iceServers(claims),
          });
          yield* this.#restoreWaitingClients(peer);
          return;
        }
        const host = this.#currentHost(claims.hostId);
        if (!host) {
          this.#peers.delete(socket.id);
          this.#metrics.activeSockets = this.#sockets.size;
          this.#fail(socket, "host_unavailable", "The host is offline.", 1013);
          return;
        }
        // A desktop serves multiple devices. Only a reconnect of the SAME logical
        // session replaces a socket; other sessions must retain their connections.
        const existing = this.#connectionForSession(claims.hostId, claims.sessionId);
        if (
          !host.multiplex &&
          [...this.#connections.values()].some(
            (connection) => connection.hostId === claims.hostId && connection !== existing,
          )
        ) {
          this.#peers.delete(socket.id);
          this.#clearPeerExpiration(socket.id);
          this.#fail(socket, "host_busy", "The host already has an active remote session.", 1013);
          return;
        }
        if (existing) this.#replaceClientSignal(existing);
        const connectionId = randomIdentifier();
        peer.connectionId = connectionId;
        this.#connections.set(connectionId, {
          id: connectionId,
          hostId: claims.hostId,
          sessionId: claims.sessionId,
          client: socket,
          host: host.socket,
        });
        this.#metrics.activePeerConnections = this.#connections.size;
        this.#send(socket, {
          type: "ready",
          version: 1,
          connectionId,
          resumeToken,
          iceServers: this.#tokens.iceServers(claims),
        });
        this.#send(host.socket, {
          type: "peer-ready",
          version: 1,
          connectionId,
          sessionId: claims.sessionId,
          userId: claims.userId,
          membershipId: claims.membershipId,
          role: memberRole(claims.role),
          sessionExpiresAt: claims.sessionExpiresAt,
          resumed: peer.resumed,
        });
      }),
  );

  /**
   * The host socket that said hello last. A host that stops with no close, such as a hosted server
   * that its provider stops, keeps its old socket until the idle timeout. Its new socket is the one
   * that answers.
   */
  #currentHost(hostId: string): AuthenticatedPeer | null {
    let current: AuthenticatedPeer | null = null;
    for (const socketId of this.#hosts.get(hostId) ?? []) current = this.#peers.get(socketId) ?? current;
    return current;
  }

  #connectionForSession(hostId: string, sessionId: string): ActiveConnection | null {
    for (const connection of this.#connections.values()) {
      if (connection.hostId === hostId && connection.sessionId === sessionId) return connection;
    }
    return null;
  }

  readonly #restoreWaitingClients = Effect.fn("Signal.restoreWaitingClients")((host: AuthenticatedPeer) =>
    Effect.gen({ self: this }, function* () {
      const tokens = yield* SignalTokens;
      const clients = [...this.#peers.values()].filter(
        (peer) => peer.peer === "client" && peer.claims.hostId === host.claims.hostId && peer.connectionId === null,
      );
      for (const client of clients) {
        if (
          !host.multiplex &&
          [...this.#connections.values()].some((connection) => connection.hostId === host.claims.hostId)
        )
          return;
        const resumeToken = yield* tokens.issueResumeToken(client.claims);
        if (this.#peers.get(host.socket.id) !== host) return;
        if (this.#peers.get(client.socket.id) !== client || client.connectionId !== null) continue;
        const connectionId = randomIdentifier();
        client.connectionId = connectionId;
        this.#connections.set(connectionId, {
          id: connectionId,
          hostId: host.claims.hostId,
          sessionId: client.claims.sessionId,
          client: client.socket,
          host: host.socket,
        });
        this.#metrics.activePeerConnections = this.#connections.size;
        this.#send(client.socket, {
          type: "ready",
          version: 1,
          connectionId,
          resumeToken,
          iceServers: this.#tokens.iceServers(client.claims),
        });
        this.#send(host.socket, {
          type: "peer-ready",
          version: 1,
          connectionId,
          sessionId: client.claims.sessionId,
          userId: client.claims.userId,
          membershipId: client.claims.membershipId,
          role: memberRole(client.claims.role),
          sessionExpiresAt: client.claims.sessionExpiresAt,
          resumed: host.resumed || client.resumed,
        });
      }
    }),
  );

  #replaceClientSignal(connection: ActiveConnection): void {
    this.#clearConnectionDrop(connection.id);
    this.#connections.delete(connection.id);
    const previous = this.#peers.get(connection.client.id);
    if (previous) {
      this.#peers.delete(connection.client.id);
      this.#clearPeerExpiration(connection.client.id);
      previous.socket.close(4000, "Remote session resumed");
    }
  }

  #dropConnection(connectionId: string, sourceSocketId: string): void {
    const connection = this.#connections.get(connectionId);
    if (!connection) return;
    this.#clearConnectionDrop(connectionId);
    this.#connections.delete(connectionId);
    const target = connection.client.id === sourceSocketId ? connection.host : connection.client;
    this.#send(target, { type: "disconnect", version: 1, connectionId });
    const clientPeer = this.#peers.get(connection.client.id);
    if (clientPeer) clientPeer.connectionId = null;
    this.#metrics.activePeerConnections = this.#connections.size;
  }

  #schedulePeerExpiration(peer: AuthenticatedPeer): void {
    this.#clearPeerExpiration(peer.socket.id);
    const remaining = peer.claims.sessionExpiresAt * 1_000 - Date.now();
    if (remaining <= 0) {
      this.#fail(peer.socket, "authentication_required", "The remote session expired.", 1008);
      return;
    }
    const timer = setTimeout(
      () => {
        this.#peerExpirationTimers.delete(peer.socket.id);
        if (this.#peers.get(peer.socket.id) !== peer) return;
        if (peer.claims.sessionExpiresAt * 1_000 > Date.now()) {
          this.#schedulePeerExpiration(peer);
          return;
        }
        this.#fail(peer.socket, "authentication_required", "The remote session expired.", 1008);
      },
      Math.min(remaining, MAXIMUM_EXPIRATION_TIMER_MILLISECONDS),
    );
    timer.unref?.();
    this.#peerExpirationTimers.set(peer.socket.id, timer);
  }

  #clearPeerExpiration(socketId: string): void {
    const timer = this.#peerExpirationTimers.get(socketId);
    if (timer) clearTimeout(timer);
    this.#peerExpirationTimers.delete(socketId);
  }

  #scheduleConnectionDrop(connection: ActiveConnection): void {
    this.#clearConnectionDrop(connection.id);
    const timer = setTimeout(
      () => this.#dropConnection(connection.id, connection.client.id),
      SIGNAL_RECONNECT_GRACE_MILLISECONDS,
    );
    timer.unref?.();
    this.#connectionDropTimers.set(connection.id, timer);
  }

  #clearConnectionDrop(connectionId: string): void {
    const timer = this.#connectionDropTimers.get(connectionId);
    if (timer) clearTimeout(timer);
    this.#connectionDropTimers.delete(connectionId);
  }

  #ownsConnection(peer: AuthenticatedPeer, connectionId: string): boolean {
    const connection = this.#connections.get(connectionId);
    return Boolean(connection && (connection.client.id === peer.socket.id || connection.host.id === peer.socket.id));
  }

  #userConnectionCount(userId: string, exceptSocketId?: string): number {
    let total = 0;
    for (const peer of this.#peers.values()) {
      if (peer.peer !== "ingress" && peer.claims.userId === userId && peer.socket.id !== exceptSocketId) total += 1;
    }
    return total;
  }

  #socketIpCount(ip: string): number {
    let total = 0;
    for (const socket of this.#sockets.values()) if (socket.ip === ip) total += 1;
    return total;
  }

  #acceptMessage(socket: SignalSocket, now = Date.now()): boolean {
    const peer = this.#peers.get(socket.id);
    // An ingress socket answers the Slack requests of every workspace linked to its host, so it has a bucket of
    // its own rather than a share of the account's and the address's. It can only answer requests
    // Signal sent it, and the delivery limits bound those.
    if (peer?.peer === "ingress") return this.#acceptRateKey(`ingress:${socket.id}`, now, INGRESS_RATE_FACTOR);
    if (!this.#acceptRateKey(`ip:${socket.ip || socket.id}`, now)) return false;
    return peer ? this.#acceptRateKey(`user:${peer.claims.userId}`, now) : true;
  }

  #acceptRateKey(key: string, now: number, factor = 1): boolean {
    this.#pruneRateWindows(now);
    const current = this.#rateWindows.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MILLISECONDS) {
      if (!current && this.#rateWindows.size >= MAXIMUM_RATE_WINDOWS) {
        const oldestKey = this.#rateWindows.keys().next().value;
        if (oldestKey) this.#rateWindows.delete(oldestKey);
      }
      if (current) this.#rateWindows.delete(key);
      this.#rateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.#maximumMessagesPerMinute * factor;
  }

  #pruneReplayCache(nowSeconds = Math.floor(Date.now() / 1_000)): void {
    for (const [jti, expiresAt] of this.#usedTicketIds) if (expiresAt <= nowSeconds) this.#usedTicketIds.delete(jti);
    for (const [sessionId, expiresAt] of this.#revokedSessions) {
      if (expiresAt <= nowSeconds) this.#revokedSessions.delete(sessionId);
    }
  }

  #pruneRateWindows(now: number): void {
    if (now - this.#lastRatePruneAt < RATE_WINDOW_MILLISECONDS) return;
    this.#lastRatePruneAt = now;
    for (const [key, window] of this.#rateWindows) {
      if (now - window.startedAt >= RATE_WINDOW_MILLISECONDS) this.#rateWindows.delete(key);
    }
  }

  #send(socket: SignalSocket, message: SignalServerMessage): void {
    socket.send(encodeSignalServerMessage(message));
  }

  #fail(socket: SignalSocket, code: SignalErrorCode, message: string, closeCode?: number): void {
    this.#send(socket, { type: "error", version: 1, code, message });
    if (closeCode) socket.close(closeCode, message);
  }
}

function memberRole(role: RemoteTicketClaims["role"]): "owner" | "admin" | "member" {
  if (role === "host") throw new Error("A host cannot create a client connection.");
  return role;
}

function randomIdentifier(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** The map key of a `discord-session` token. A hash, so a lookup does not compare the secret itself. */
function discordSessionKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** One Slack app in one workspace. The production and development apps can share a workspace. */
function slackRouteKey(appId: string, teamId: string): string {
  return `${appId}:${teamId}`;
}
