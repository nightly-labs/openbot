import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  type AgentEvent,
  type AgentSummary,
  AnalyticsInputError,
  type DirectConversationPage,
  type DirectConversationPageAnchor,
  type DirectConversationSnapshot,
  type DirectMessage,
  type DirectMessageRealtimeEvent,
  type DirectThreadSummary,
  type DirectTypingRealtimeEvent,
  type DuplicateAgentResult,
  isAgentEvent,
  isTeamRealtimeEvent,
  type SidebarLayoutSnapshot,
  type TeamMemberSummary,
  type TeamPresenceSnapshot,
  type TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  AGENT_ADMIN_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  isTeamCurrentCapability,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  STORAGE_CAPABILITY,
  supportsTeamSemanticTags,
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  type TeamCurrentCapability,
} from "@openbot/contracts/team-protocol/current";
import {
  HOST_RESTART_EVENT,
  type HostRestartEvent,
  type HostRestartState,
} from "@openbot/contracts/team-protocol/host-update-v1";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
  type TeamProtocolSupportV1,
} from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV1CurrentClientEvent,
  encodeTeamProtocolV1CurrentEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "@openbot/contracts/team-protocol/v4-base-adapter";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v5";
import { encodeTeamProtocolV5BaseCurrentEvent } from "@openbot/contracts/team-protocol/v5-base-adapter";
import { TEAM_CURSOR_CLINE_CAPABILITY, TEAM_PROTOCOL_V6 } from "@openbot/contracts/team-protocol/v6";
import { encodeTeamProtocolV6BaseCurrentEvent } from "@openbot/contracts/team-protocol/v6-base-adapter";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import type * as Ws from "ws";
import { AgentDuplicationFailed, duplicateAgentIntoLayout } from "../backend/agent/duplication-gate";
import { runCauseEffect } from "../backend/effect-boundary";
import { McpServerError } from "../backend/mcp-server-store";
import { StoredStateFailure } from "../backend/stored-state-effects";
import type { TeamChatStore } from "../backend/team-chat-store";
import { LifecycleGate } from "./lifecycle-gate";
import { RemoteScreenError } from "./remote-screen-gateway";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import { isClientUse } from "./team-api/client-use";
import type { TeamApiOptions, TeamApiSidebarLayout } from "./team-api/dependencies";
import { HttpError } from "./team-api/http-error";
import {
  hiddenAgentView,
  hiddenProviderAgentIds,
  isPeerHiddenProvider,
  legacyProviderView,
} from "./team-api/provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./team-api/request-context";
import {
  bearerToken,
  conversationSnapshotForCapabilities,
  firstHeaderValue,
  JSON_LIMIT,
  pathIdentifier,
  readJson,
  requestCapabilities,
  requestProtocol,
  stringField,
} from "./team-api/request-helpers";
import { routeAgentAdmin } from "./team-api/route-agent-admin";
import { routeAgentImport } from "./team-api/route-agent-import";
import { routeAgentInstall } from "./team-api/route-agent-install";
import { routeAgentPublish } from "./team-api/route-agent-publish";
import { routeAgents } from "./team-api/route-agents";
import { routeBrowser } from "./team-api/route-browser";
import { routeChannels } from "./team-api/route-channels";
import { routeContextReset } from "./team-api/route-context-reset";
import { routeDirect } from "./team-api/route-direct";
import { routeFiles } from "./team-api/route-files";
import { routeHostAdmin } from "./team-api/route-host-admin";
import { routeHostUpdate } from "./team-api/route-host-update";
import { routeHostedSites } from "./team-api/route-hosted-sites";
import { routeLiveActivityPush } from "./team-api/route-live-activity-push";
import { routeMcpServers } from "./team-api/route-mcp";
import { routeProviders } from "./team-api/route-providers";
import { routeRemoteScreen } from "./team-api/route-remote-screen";
import { routeSharedTables } from "./team-api/route-shared-tables";
import { routeSkillsAdmin } from "./team-api/route-skills-admin";
import { routeStorage } from "./team-api/route-storage";
import { routeTeam } from "./team-api/route-team";
import { routeWorkspaceDirectory } from "./team-api/route-workspace-directory";
import { TeamStoreError } from "./team-store";

const EVENT_PAYLOAD_LIMIT = 256 * 1_024;
const TYPING_TIMEOUT_MS = 5_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const RATE_LIMIT_SWEEP_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_CAPACITY = 10_000;
const RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS = 1_000;
const TEST_LEGACY_EVENT_PROTOCOL = "openbot-events";
const TEST_LEGACY_SNAPSHOT_PROTOCOL = "openbot-events-v2";
const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

const logger = createOpenBotLogger("team-api-server");

interface EventClientState {
  token: string;
  memberId: string;
  capabilities: Set<string>;
  includeConversationEvents: boolean;
  typingAgentId: string | null;
  typingTimer: ReturnType<typeof setTimeout> | null;
  directTypingRecipientId: string | null;
  directTypingTimer: ReturnType<typeof setTimeout> | null;
  snapshotResponsePending: boolean;
  snapshotRequestQueued: boolean;
  nextSnapshotRequestAt: number;
}

interface RateEntry {
  attempts: number;
  resetAt: number;
}

interface TeamProtocolIssue {
  status: 400 | 426;
  body: {
    error: string;
    code: "client_update_required" | "host_update_required" | "protocol_error";
    host: TeamProtocolSupportV1;
    client?: { appVersion: string; protocol: number };
  };
}

export class TeamApiServer {
  readonly #options: Omit<TeamApiOptions, "sidebarLayout"> & { sidebarLayout: TeamApiSidebarLayout };
  readonly #rateLimits = new Map<string, RateEntry>();
  readonly #eventClients = new Map<Ws.WebSocket, EventClientState>();
  #hostRestart: HostRestartEvent = { type: HOST_RESTART_EVENT, state: "none", version: null };
  readonly #responseRoutes = new WeakMap<
    ServerResponse,
    { method: string; path: string; protocol: number; capabilities: Set<string>; hiddenAgentIds?: ReadonlySet<string> }
  >();
  readonly #duplicateRequests = new Map<
    string,
    { sourceAgentId: string; result: Deferred.Deferred<DuplicateAgentResult, AgentDuplicationFailed> }
  >();
  readonly #webSockets = new webSockets.WebSocketServer({
    noServer: true,
    maxPayload: EVENT_PAYLOAD_LIMIT,
    handleProtocols: (protocols) =>
      protocols.has(TEAM_PROTOCOL_V1_WEBSOCKET)
        ? TEAM_PROTOCOL_V1_WEBSOCKET
        : protocols.has(TEST_LEGACY_SNAPSHOT_PROTOCOL)
          ? TEST_LEGACY_SNAPSHOT_PROTOCOL
          : protocols.has(TEST_LEGACY_EVENT_PROTOCOL)
            ? TEST_LEGACY_EVENT_PROTOCOL
            : false,
  });
  readonly #rateLimitCapacity: number;
  readonly #now: () => number;
  #server: Server | null = null;
  readonly #lifecycle = new LifecycleGate<number, RemoteWorkflowError>();
  #port: number | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #lastClientUseAt: number | null = null;
  #agentListener: ((event: AgentEvent) => void) | null = null;
  #sidebarLayoutListener: ((layout: SidebarLayoutSnapshot) => void) | null = null;
  #localTypingAgentId: string | null = null;
  readonly #reportedUnrepresentableAgents = new Set<string>();
  #nextRateLimitSweepAt = 0;

  constructor(options: TeamApiOptions) {
    this.#options = { ...options, sidebarLayout: options.sidebarLayout ?? unavailableSidebarLayout() };
    this.#rateLimitCapacity = options.rateLimitCapacity ?? RATE_LIMIT_CAPACITY;
    this.#now = options.now ?? Date.now;
  }

  get port(): number | null {
    return this.#port;
  }

  // Without the gate, two starts at once open two listeners and lose one, and a stop during a start
  // runs before the listener exists. A listener lost that way stays open for the previous account.
  start(): Effect.Effect<number, RemoteWorkflowError> {
    // A dependency that throws while the listener starts is a failed start, so the host stops it.
    return this.#lifecycle.start(() =>
      this.#start().pipe(Effect.catchDefect((cause) => Effect.fail(new RemoteWorkflowError({ cause })))),
    );
  }

  stop(): Effect.Effect<void, RemoteWorkflowError> {
    return this.#lifecycle.stop(() => this.#stop());
  }

  readonly #start = Effect.fn("TeamApiServer.start")(function* (this: TeamApiServer) {
    if (this.#server && this.#port) return this.#port;
    const server = createServer((request, response) => void this.#handle(request, response));
    this.#server = server;
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (this.#options.remoteScreen?.handlesUpgrade(url)) {
        this.#options.remoteScreen.handleUpgrade(request, socket, head, url);
        return;
      }
      // Like the remote screen, and above the token check for the same reason: a tunneled view
      // socket carries the WebRTC session this host opened it for rather than a member's token.
      if (this.#options.browserView?.handlesUpgrade(url)) {
        this.#options.browserView.handleUpgrade(request, socket, head, url);
        return;
      }
      const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
      if (
        this.#options.appVersion &&
        url.pathname === TEAM_API_ROUTES.events &&
        !protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET)
      ) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const encodedToken = protocols.find((value) => value.startsWith("openbot-token."));
      const token = encodedToken?.slice("openbot-token.".length) ?? "";
      const member = token.length <= 512 ? this.#options.store.authenticate(token) : null;
      if (!member) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (
        url.pathname === TEAM_API_ROUTES.events &&
        (protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET) ||
          (!this.#options.appVersion &&
            (protocols.includes(TEST_LEGACY_SNAPSHOT_PROTOCOL) || protocols.includes(TEST_LEGACY_EVENT_PROTOCOL))))
      ) {
        this.#webSockets.handleUpgrade(request, socket, head, (client) => {
          this.#connectEvents(
            client,
            token,
            member.id,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET || client.protocol === TEST_LEGACY_SNAPSHOT_PROTOCOL,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET,
          );
        });
        return;
      }
      if (url.pathname === TEAM_API_ROUTES.remoteDesktopUpgrade) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
    yield* remoteCall(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve());
        }),
    );
    const address = server.address();
    if (!address || isString(address)) {
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.team.bindFailed")) });
    }
    this.#port = address.port;
    this.#agentListener = (event) => this.#broadcastAgentEvent(event);
    this.#options.agents.on("event", this.#agentListener);
    this.#sidebarLayoutListener = (layout) => this.#broadcastAgentEvent({ type: "sidebar-layout-changed", layout });
    this.#options.sidebarLayout.on("changed", this.#sidebarLayoutListener);
    this.#heartbeat = setInterval(() => {
      for (const [client, connection] of this.#eventClients) {
        if (!this.#options.store.authenticate(connection.token)) {
          client.close(1008, "Team access was revoked");
        } else if (client.readyState === webSockets.WebSocket.OPEN) client.ping();
      }
    }, 15_000);
    this.#heartbeat.unref?.();
    this.#publishPresence();
    return address.port;
  }).bind(this);

  readonly #stop = Effect.fn("TeamApiServer.stop")(function* (this: TeamApiServer) {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    if (this.#agentListener) this.#options.agents.off("event", this.#agentListener);
    this.#agentListener = null;
    if (this.#sidebarLayoutListener) this.#options.sidebarLayout.off("changed", this.#sidebarLayoutListener);
    this.#sidebarLayoutListener = null;
    for (const [client, connection] of this.#eventClients) {
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      client.close(1001, "Server stopped");
    }
    this.#eventClients.clear();
    this.#localTypingAgentId = null;
    const { remoteScreen, browserView } = this.#options;
    yield* Effect.gen(function* () {
      if (remoteScreen) yield* remoteScreen.stop();
      if (browserView) yield* browserView.stop();
    }).pipe(
      Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })),
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          // The heartbeat and the event listeners are already gone. Leaving the socket open
          // would let the next `start()` hand back its port unchanged, so the previous account
          // keeps a listener that no longer checks a revoked session or delivers an event.
          const server = this.#server;
          this.#server = null;
          this.#port = null;
          if (server) {
            yield* Effect.callback<void>((resume) => {
              server.close(() => resume(Effect.void));
            });
          }
          this.#publishPresence();
        }),
      ),
    );
  }).bind(this);

  getPresence(): TeamPresenceSnapshot {
    const identity = this.#options.store.getIdentity();
    if (!identity) {
      return { serverId: null, members: [], updatedAt: new Date().toISOString() };
    }
    const connections = [...this.#eventClients.values()];
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    return {
      serverId: identity.serverId,
      members: this.#options.store.listMembers().map((member) => {
        const memberConnections = connections.filter((connection) => connection.memberId === member.id);
        return {
          ...member,
          online: memberConnections.length > 0 || (member.id === owner?.id && this.#server !== null),
          typingAgentId:
            (member.id === owner?.id ? this.#localTypingAgentId : null) ??
            memberConnections.find((connection) => connection.typingAgentId)?.typingAgentId ??
            null,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Remote clients with an open event stream. Each WebRTC client opens one after it signs in. */
  connectedClientCount(): number {
    return this.#eventClients.size;
  }

  /**
   * The last user action from a client - a send, a change, or a typing event - or null for none. Reads,
   * polls and mark-read do not count: a client that is only open does not keep a hosted server running.
   */
  lastClientUseAt(): number | null {
    return this.#lastClientUseAt;
  }

  setLocalTyping(agentId: string | null, typing: boolean): void {
    const next = typing && this.#server ? agentId : null;
    if (next === this.#localTypingAgentId) return;
    this.#localTypingAgentId = next;
    this.#publishPresence();
  }

  refreshPresence(): void {
    for (const [client, connection] of this.#eventClients) {
      if (!this.#options.store.authenticate(connection.token)) {
        client.close(1008, "Team access was revoked");
      }
    }
    this.#publishPresence();
  }

  refreshIdentity(): void {
    const identity = this.#options.store.getIdentity();
    if (!identity) return;
    const event: TeamRealtimeEvent = {
      type: "team-identity",
      serverId: identity.serverId,
      serverName: identity.serverName,
      logoVersion: identity.logoVersion,
    };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(event, connection.capabilities);
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  /**
   * Tells every member with `host-update-v1` that this host restarts into an update. It is outside the
   * frozen event vocabulary, so it bypasses the encoders like a channel event does.
   */
  announceHostRestart(state: HostRestartState, version: string | null): void {
    this.#hostRestart = { type: HOST_RESTART_EVENT, state, version };
    for (const [client, connection] of this.#eventClients) this.#sendHostRestart(client, connection);
  }

  #sendHostRestart(client: Ws.WebSocket, connection: EventClientState): void {
    if (!connection.capabilities.has(HOST_UPDATE_CAPABILITY)) return;
    if (client.readyState === webSockets.WebSocket.OPEN) client.send(JSON.stringify(this.#hostRestart));
  }

  listDirectThreads(memberId: string): DirectThreadSummary[] {
    return this.#requireChat().listThreads(memberId);
  }

  readDirectConversation(memberId: string, otherMemberId: string): DirectConversationSnapshot {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversation(memberId, otherMemberId);
  }

  readDirectConversationPage(
    memberId: string,
    otherMemberId: string,
    anchor: DirectConversationPageAnchor,
    limit: number,
  ): DirectConversationPage {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversationPage(memberId, otherMemberId, anchor, limit);
  }

  sendDirectMessage(
    senderMemberId: string,
    input: { memberId: string; text: string; clientMessageId: string },
  ): DirectMessage {
    this.#requireDirectRecipient(senderMemberId, input.memberId);
    const message = this.#requireChat().sendMessage({
      clientMessageId: input.clientMessageId,
      senderMemberId,
      recipientMemberId: input.memberId,
      text: input.text,
    });
    this.#publishDirectMessage(message);
    return message;
  }

  markDirectRead(memberId: string, otherMemberId: string, throughSequence: number) {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().markRead(memberId, otherMemberId, throughSequence);
  }

  setLocalDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    this.#requireDirectRecipient(senderMemberId, recipientMemberId);
    this.#publishDirectTyping(senderMemberId, recipientMemberId, typing);
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    // The route is recorded before the target is parsed, because `#json` cannot answer without it and
    // this is the first thing below that can throw. Node's HTTP parser accepts request targets the
    // WHATWG URL parser rejects - `GET //[ HTTP/1.1` arrives as `//[` - and with the record written
    // afterwards that throw reached the catch below, made `#json` throw "route is unavailable", and
    // surfaced as an unhandled rejection over a socket nothing ever ended.
    //
    // The placeholder is `/` and not the raw target, because the record is not a log line: the
    // frozen adapters classify the route by parsing this string again, from inside the encoder the
    // catch is calling. Handing them the target that just failed to parse throws the same
    // `Invalid URL` back out of `#json`, past the only catch there is, and hangs the socket exactly
    // as before - on every protocol above v1, where classification starts. `/` is the honest answer
    // to "which route is this": there is none, and both adapters encode it as the unclassified route
    // it is. `url.pathname` replaces it the moment there is one.
    this.#responseRoutes.set(response, {
      method,
      path: "/",
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
    });
    try {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      this.#responseRoutes.set(response, {
        method,
        path: url.pathname,
        protocol: requestProtocol(request),
        capabilities: requestCapabilities(request),
      });

      // Three gates, in this order, and the order is the whole point of writing them out.
      //
      // `compatibility` is above the protocol gate because it is the endpoint that tells an
      // out-of-date client to update. Behind the gate it would answer 426 as well, and the client
      // would have no way to read the instruction it was being given: a 426 loop with no exit.
      //
      // The remote-screen delegation sits between them, above the protocol gate for the same reason:
      // a browser fetching the viewer sends neither protocol headers nor a bearer token. It is not a
      // route in the table; the gateway decides for itself which paths are its own.
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.compatibility) {
        return this.#json(response, 200, this.#protocolSupport());
      }

      if (this.#options.remoteScreen?.handlesHttp(url)) {
        await runCauseEffect(this.#options.remoteScreen.handleHttp(request, response, url));
        return;
      }

      const protocolIssue = this.#protocolIssue(request);
      if (protocolIssue) return this.#json(response, protocolIssue.status, protocolIssue.body);

      // The six unauthenticated routes stay here rather than moving to a module of their own. They
      // sit astride the auth gate below, so a module holding them would need a context without a
      // member while every other module needs one with a member - two shapes of the same type, to
      // save sixty lines that have not changed in the life of the file.
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.identity) {
        const challenge = url.searchParams.get("challenge");
        return this.#json(
          response,
          200,
          challenge ? this.#options.store.getIdentityProof(challenge) : this.#options.store.getIdentity(),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.invitationPreview) {
        const body = await readJson(request);
        return this.#json(
          response,
          200,
          this.#options.store.previewInvite(stringField(body, "inviteToken", false, INPUT_LIMITS.identifier)),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.server) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.acceptInvite(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        const result = await runCauseEffect(
          this.#options.store.acceptInviteWithAccount(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            user,
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.login) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.login(
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 200, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        return this.#json(response, 200, await runCauseEffect(this.#options.store.loginWithAccount(user)));
      }

      // The auth gate does not look at the path. An unknown route without a token is 401, not 404,
      // and that is deliberate: answering 404 would let anyone map which endpoints this host has.
      const token = bearerToken(request.headers.authorization);
      const authenticated = token ? this.#options.store.authenticateSession(token) : null;
      if (!authenticated || !token) {
        return this.#json(response, 401, { error: sourceText("error.team.authenticationRequired") });
      }
      if (isClientUse(method, url.pathname)) this.#lastClientUseAt = Date.now();
      const context = this.#requestContext(request, response, url, token, authenticated);
      const hidden = this.#hiddenAgentIds(context.protocol, context.capabilities);
      // Every protocol gets the projection, also with no hidden agent: a provider status row, a
      // model or an auth state of a local-only provider can be in the response.
      const responseRoute = this.#responseRoutes.get(response);
      if (responseRoute) responseRoute.hiddenAgentIds = hidden;
      const agentId = url.pathname.match(/^\/v1\/agents\/([^/]+)/u)?.[1];
      if (
        (agentId && hidden.has(pathIdentifier(agentId, "agentId"))) ||
        [url.searchParams.get("agentId"), url.searchParams.get("botId")].some((id) => id !== null && hidden.has(id))
      ) {
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      }
      // A template, a marketplace agent and an imported one start where a new agent does.
      const newAgentHidden = () => {
        const provider = this.#options.agents.newAgentProvider();
        return provider !== null && isPeerHiddenProvider(provider, context.protocol);
      };

      // First module that does not say "unmatched" wins, and the dispatcher then does nothing at
      // all - work after a `writeHead` is an `ERR_HTTP_HEADERS_SENT` thrown into the catch below,
      // over a response that has already been sent.
      //
      // Sequence is safe because the six prefixes are disjoint, so a request that falls out of one
      // module could not have matched a later one in the single chain this replaced. What that
      // relies on is each module answering "unmatched" for a method it does not serve rather than
      // 404 on its own: the 404 below is the only one in the Team API, which is what keeps a wrong
      // method on a known path answering 404 - never 405 - exactly as the released clients expect.
      if ((await this.#routeTeam(context)) === "handled") return;
      if ((await this.#routeRemoteScreen(context)) === "handled") return;
      if ((await this.#routeDirect(context)) === "handled") return;
      if ((await this.#routeBrowser(context)) === "handled") return;
      if ((await this.#routeFiles(context)) === "handled") return;
      if ((await routeChannels(context, this.#options.channels, this.#options.agents)) === "handled") return;
      if (
        (await routeMcpServers(context, this.#options.mcpServers, this.#options.mcpToolRuntimePreparation)) ===
        "handled"
      )
        return;
      if ((await routeStorage(context, this.#options.storage)) === "handled") return;
      if ((await routeHostedSites(context, this.#options.hostedSites)) === "handled") return;
      if ((await routeAgentAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeSkillsAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeSharedTables(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentInstall(context, this.#options.admin, hidden, newAgentHidden)) === "handled") return;
      if ((await routeAgentPublish(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeProviders(context, this.#options.admin)) === "handled") return;
      if ((await routeHostAdmin(context, this.#options.admin)) === "handled") return;
      if ((await routeHostUpdate(context, this.#options.admin)) === "handled") return;
      if ((await routeContextReset(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeWorkspaceDirectory(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentImport(context, this.#options.agentImport, newAgentHidden)) === "handled") return;
      if (
        (await routeLiveActivityPush(context, this.#options.liveActivityPush, () =>
          this.#hiddenAgentIds(context.protocol, context.capabilities),
        )) === "handled"
      )
        return;
      if ((await this.#routeAgents(context)) === "handled") return;

      // The only 404 in the Team API.
      return this.#json(response, 404, { error: sourceText("error.team.routeNotFound") });
    } catch (error) {
      // The only catch, too. A module with its own would cut an unexpected error off from the
      // logger below and answer 400 where the failure was a 500 nobody would then ever see.
      const expected =
        error instanceof HttpError ||
        error instanceof RemoteScreenError ||
        error instanceof TeamStoreError ||
        error instanceof McpServerError ||
        error instanceof AnalyticsInputError;
      const status =
        error instanceof HttpError || error instanceof RemoteScreenError ? error.status : expected ? 400 : 500;
      const message = expected ? error.message : sourceText("error.team.requestFailed");
      const code = error instanceof RemoteScreenError ? error.code : undefined;
      if (!expected) (this.#options.logger ?? logger).error("Team API request failed:", toLogValue(error));
      // A streamed file can fail after its head is on the wire. A second head is not possible, so
      // the socket closes and the client sees an incomplete download.
      if (response.headersSent) {
        response.destroy();
        return;
      }
      return this.#json(response, status, { error: message, ...(code ? { code } : {}) });
    }
  }

  // One method per module, so the dispatcher above reads as a list of domains and the wiring of
  // each narrow `*RouteDependencies` sits next to nothing else.
  #routeTeam(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeTeam(context, {
      store: this.#options.store,
      remoteScreen: this.#options.remoteScreen,
      createInvite: this.#options.createInvite,
      onSessionRevoked: this.#options.onSessionRevoked,
      getPresence: () => this.getPresence(),
      refreshPresence: () => this.refreshPresence(),
    });
  }

  #routeRemoteScreen(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeRemoteScreen(context, {
      store: this.#options.store,
      remoteScreen: this.#options.remoteScreen,
    });
  }

  #routeDirect(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeDirect(context, {
      listDirectThreads: (memberId) => this.listDirectThreads(memberId),
      readDirectConversation: (memberId, otherMemberId) => this.readDirectConversation(memberId, otherMemberId),
      readDirectConversationPage: (memberId, otherMemberId, anchor, limit) =>
        this.readDirectConversationPage(memberId, otherMemberId, anchor, limit),
      sendDirectMessage: (senderMemberId, input) => this.sendDirectMessage(senderMemberId, input),
      markDirectRead: (memberId, otherMemberId, throughSequence) =>
        this.markDirectRead(memberId, otherMemberId, throughSequence),
    });
  }

  #routeBrowser(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeBrowser(context, { browser: this.#options.browser, browserView: this.#options.browserView });
  }

  #routeFiles(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeFiles(context, { agents: this.#options.agents, mailbox: this.#options.mailbox });
  }

  #routeAgents(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeAgents(context, {
      agents: this.#options.agents,
      skills: this.#options.skills,
      sidebarLayout: this.#options.sidebarLayout,
      duplicateAgent: (agentId, operationId) => this.#duplicateAgent(agentId, operationId),
    });
  }

  #checkRate(request: IncomingMessage, username: string): void {
    const key = `${request.socket.remoteAddress ?? "local"}:${username.toLowerCase()}`;
    const now = this.#now();
    this.#pruneRateLimits(now, this.#rateLimits.size >= this.#rateLimitCapacity);
    const current = this.#rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.#rateLimits.size >= this.#rateLimitCapacity) {
        throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
      }
      this.#rateLimits.set(key, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    current.attempts += 1;
    if (current.attempts > RATE_LIMIT_ATTEMPTS) {
      throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
    }
  }

  #pruneRateLimits(now: number, force: boolean): void {
    if (!force && now < this.#nextRateLimitSweepAt) return;
    for (const [key, entry] of this.#rateLimits) {
      if (entry.resetAt <= now) this.#rateLimits.delete(key);
    }
    this.#nextRateLimitSweepAt = now + RATE_LIMIT_SWEEP_MS;
  }

  #encodeProviderEvent(
    event: AgentEvent | TeamRealtimeEvent,
    capabilities: ReadonlySet<string>,
    options: { preserveSemanticTags?: boolean } = {},
  ): string | null {
    const protocol = eventProtocol(capabilities);
    const hidden = hiddenProviderAgentIds(this.#options.agents.listAgents(), protocol);
    const visible = protocol === 1 ? legacyProviderView(event, hidden) : hiddenAgentView(event, hidden, protocol);
    if (!isAgentEvent(visible) && !isTeamRealtimeEvent(visible)) return null;
    if (protocol !== 1)
      return (
        protocol === 6
          ? encodeTeamProtocolV6BaseCurrentEvent
          : protocol === 5
            ? encodeTeamProtocolV5BaseCurrentEvent
            : encodeTeamProtocolV4BaseCurrentEvent
      )(visible, {
        ...options,
        preserveBrowserSecrets: capabilities.has("browser-secret-handoff"),
      });
    return encodeTeamProtocolV1CurrentEvent(visible, options);
  }

  #broadcastAgentEvent(event: AgentEvent): void {
    const filteredConversationPayloads = new Map<string, string>();

    for (const [client, connection] of this.#eventClients) {
      // An event this client's protocol cannot describe is skipped for this client only. Thrown
      // out of the loop, it would stop the event for every client after this one.
      const encodeEvent = (event: AgentEvent, options = {}) => {
        try {
          return this.#encodeProviderEvent(event, connection.capabilities, options);
        } catch (error) {
          (this.#options.logger ?? logger).warn("Team API event could not be encoded:", toLogValue(error));
          return null;
        }
      };
      const encodingOptions = { preserveSemanticTags: supportsTeamSemanticTags(connection.capabilities) };
      const supportsRuntimeSnapshots = connection.capabilities.has("agent-runtime-snapshots");
      const requiredCapability = eventCapability(event);
      if (requiredCapability && !connection.capabilities.has(requiredCapability)) continue;
      if (event.type === "conversation" && !connection.includeConversationEvents) continue;
      if (event.type === "queue-changed" && supportsRuntimeSnapshots && !connection.includeConversationEvents) {
        continue;
      }
      let conversationInvalidation: string | undefined;
      let queueInvalidation: string | undefined;
      let outgoing: string;
      // `eventCapability` above has already kept an optional event from a client without its capability.
      const optional = optionalTeamEvent(event);
      if (optional) {
        // The base events go through the provider view; an optional event that names a hidden agent is left out.
        if (
          "agentId" in optional &&
          hiddenProviderAgentIds(this.#options.agents.listAgents(), eventProtocol(connection.capabilities)).has(
            optional.agentId,
          )
        )
          continue;
        outgoing = JSON.stringify(optional);
      } else if (event.type === "conversation" && supportsRuntimeSnapshots) {
        conversationInvalidation ??=
          encodeEvent({
            type: "conversation-invalidated",
            agentId: event.snapshot.agentId,
            revision: event.snapshot.revision,
          }) ?? undefined;
        if (!conversationInvalidation) continue;
        outgoing = conversationInvalidation;
      } else if (event.type === "queue-changed" && supportsRuntimeSnapshots) {
        queueInvalidation ??= encodeEvent({ type: "queue-invalidated", agentId: event.snapshot.agentId }) ?? undefined;
        if (!queueInvalidation) continue;
        outgoing = queueInvalidation;
      } else if (
        event.type === "conversation" &&
        (!connection.capabilities.has("routine-event-markers") ||
          !connection.capabilities.has("routine-run-event-markers") ||
          !connection.capabilities.has("hosted-site-event-markers"))
      ) {
        const key = `${eventProtocol(connection.capabilities)}:${connection.capabilities.has("opencode")}:${connection.capabilities.has("routine-event-markers")}:${connection.capabilities.has("routine-run-event-markers")}:${connection.capabilities.has("hosted-site-event-markers")}:${encodingOptions.preserveSemanticTags}`;
        let filtered = filteredConversationPayloads.get(key);
        if (!filtered) {
          filtered =
            encodeEvent(
              {
                ...event,
                snapshot: conversationSnapshotForCapabilities(event.snapshot, connection.capabilities),
              },
              encodingOptions,
            ) ?? undefined;
          if (filtered) filteredConversationPayloads.set(key, filtered);
        }
        if (!filtered) continue;
        outgoing = filtered;
      } else {
        const payload = encodeEvent(event, encodingOptions) ?? undefined;
        if (!payload) continue;
        outgoing = payload;
      }
      const limit = event.type === "runtime-snapshot" ? AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT : JSON_LIMIT;
      if (Buffer.byteLength(outgoing) > limit) continue;
      if (client.readyState !== webSockets.WebSocket.OPEN) continue;
      client.send(outgoing);
      if (event.type !== "turn-completed" || !supportsRuntimeSnapshots || connection.includeConversationEvents) {
        continue;
      }
      const completionSnapshot =
        encodeEvent(
          {
            type: "runtime-snapshot",
            snapshot: this.#options.agents.getRuntimeSnapshot(),
          },
          encodingOptions,
        ) ?? undefined;
      if (!completionSnapshot) continue;
      // The snapshot is this client's own. It does not fit, so this client loses the snapshot and
      // keeps the turn, and the clients after it in the loop still get the turn.
      if (Buffer.byteLength(completionSnapshot) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) continue;
      client.send(completionSnapshot);
    }
  }

  #connectEvents(
    client: Ws.WebSocket,
    token: string,
    memberId: string,
    supportsSnapshotTransport: boolean,
    acceptsCapabilityDeclaration: boolean,
  ): void {
    const connection: EventClientState = {
      token,
      memberId,
      capabilities: new Set(
        acceptsCapabilityDeclaration
          ? []
          : TEAM_PROTOCOL_V1_CAPABILITIES.filter(
              (capability) =>
                capability !== "routine-event-markers" &&
                capability !== "routine-run-event-markers" &&
                capability !== "hosted-site-event-markers" &&
                (supportsSnapshotTransport || capability !== "agent-runtime-snapshots"),
            ),
      ),
      includeConversationEvents: !supportsSnapshotTransport,
      typingAgentId: null,
      typingTimer: null,
      directTypingRecipientId: null,
      directTypingTimer: null,
      snapshotResponsePending: false,
      snapshotRequestQueued: false,
      nextSnapshotRequestAt: 0,
    };
    this.#eventClients.set(client, connection);
    client.on("error", () => {
      // Protocol errors, including maxPayload violations, also close the socket.
      // Consume the emitted error so malformed input cannot become an uncaught exception.
    });
    if (connection.capabilities.has("agent-runtime-snapshots")) {
      this.#sendRuntimeSnapshot(client, connection, false);
    }
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        client.close(1003, "Text events are required");
        return;
      }
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data).toString("utf8");
        if (text.length > EVENT_PAYLOAD_LIMIT) throw new Error("Event payload is too large.");
        const event = decodeTeamProtocolV1CurrentClientEvent(JSON.parse(text));
        if (event.type === "runtime-snapshot-request" && connection.capabilities.has("agent-runtime-snapshots")) {
          this.#sendRuntimeSnapshot(client, connection, true);
          return;
        }
        if (event.type === "agent-event-scope" && supportsSnapshotTransport) {
          if (acceptsCapabilityDeclaration) {
            if (!event.capabilities) throw new Error("Invalid client capabilities.");
            const snapshotsWereEnabled = connection.capabilities.has("agent-runtime-snapshots");
            const restartWasSent = connection.capabilities.has(HOST_UPDATE_CAPABILITY);
            connection.capabilities = new Set(event.capabilities.filter(isTeamCurrentCapability));
            if (connection.capabilities.has("agent-runtime-snapshots") && !snapshotsWereEnabled) {
              this.#sendRuntimeSnapshot(client, connection, false);
            }
            // A member that connects while a restart waits learns about it here, not at the next change.
            if (!restartWasSent && this.#hostRestart.state !== "none") this.#sendHostRestart(client, connection);
          }
          connection.includeConversationEvents = event.includeConversations;
          return;
        }
        if (event.type === "team-direct-typing") {
          if (!connection.capabilities.has("direct-messages")) {
            throw new Error("Direct messages are not enabled for this client.");
          }
          const typing = event.typing;
          const recipientMemberId = event.recipientMemberId;
          if (recipientMemberId.length > INPUT_LIMITS.identifier) {
            throw new Error("Invalid direct typing recipient.");
          }
          this.#requireDirectRecipient(memberId, recipientMemberId);
          this.#setClientDirectTyping(connection, typing ? recipientMemberId : null);
          return;
        }
        if (event.type !== "team-typing") throw new Error("Unsupported team event.");
        const typing = event.typing;
        const agentId = event.agentId;
        if (typing && (!agentId || agentId.length > INPUT_LIMITS.identifier)) {
          throw new Error("A valid agent is required for typing state.");
        }
        this.#setClientTyping(connection, typing ? agentId : null);
      } catch {
        client.close(1003, "Invalid team event payload");
      }
    });
    // iOS can suspend a phone before it says that it goes away. Its closed connection says so.
    const sessionId = this.#options.store.authenticateSession(token)?.sessionId;
    client.once("close", () => {
      if (sessionId) this.#options.liveActivityPush?.disconnected(sessionId);
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      const directTypingRecipientId = connection.directTypingRecipientId;
      connection.directTypingRecipientId = null;
      this.#eventClients.delete(client);
      if (directTypingRecipientId && !this.#hasDirectTyping(connection.memberId, directTypingRecipientId)) {
        this.#publishDirectTyping(connection.memberId, directTypingRecipientId, false);
      }
      this.#publishPresence();
    });
    this.#publishPresence();
  }

  #sendRuntimeSnapshot(client: Ws.WebSocket, connection: EventClientState, rateLimited: boolean): void {
    const now = this.#now();
    if (connection.snapshotResponsePending) {
      if (rateLimited) connection.snapshotRequestQueued = true;
      return;
    }
    if (
      client.readyState !== webSockets.WebSocket.OPEN ||
      client.bufferedAmount > EVENT_PAYLOAD_LIMIT ||
      (rateLimited && now < connection.nextSnapshotRequestAt)
    ) {
      return;
    }
    connection.snapshotResponsePending = true;
    if (rateLimited) connection.nextSnapshotRequestAt = now + RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS;
    try {
      const payload = this.#encodeProviderEvent(
        {
          type: "runtime-snapshot",
          snapshot: this.#options.agents.getRuntimeSnapshot(),
        },
        connection.capabilities,
      );
      if (!payload) throw new Error("Runtime snapshot is not supported by Team protocol v1.");
      if (Buffer.byteLength(payload) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) {
        throw new Error("Runtime snapshot exceeds its transport budget.");
      }
      client.send(payload, (error) => {
        connection.snapshotResponsePending = false;
        if (error && client.readyState === webSockets.WebSocket.OPEN) {
          client.close(1011, "Runtime snapshot could not be sent");
          return;
        }
        if (connection.snapshotRequestQueued) {
          connection.snapshotRequestQueued = false;
          this.#sendRuntimeSnapshot(client, connection, true);
        }
      });
    } catch {
      connection.snapshotResponsePending = false;
      client.close(1011, "Runtime snapshot could not be created");
    }
  }

  #setClientTyping(connection: EventClientState, agentId: string | null): void {
    this.#lastClientUseAt = Date.now();
    const changed = connection.typingAgentId !== agentId;
    connection.typingAgentId = agentId;
    if (connection.typingTimer) clearTimeout(connection.typingTimer);
    connection.typingTimer = agentId
      ? setTimeout(() => {
          connection.typingTimer = null;
          if (!connection.typingAgentId) return;
          connection.typingAgentId = null;
          this.#publishPresence();
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.typingTimer?.unref?.();
    if (changed) this.#publishPresence();
  }

  #setClientDirectTyping(connection: EventClientState, recipientMemberId: string | null): void {
    this.#lastClientUseAt = Date.now();
    const previousRecipientId = connection.directTypingRecipientId;
    const changed = previousRecipientId !== recipientMemberId;
    const recipientAlreadyActive = recipientMemberId
      ? this.#hasDirectTyping(connection.memberId, recipientMemberId)
      : false;
    connection.directTypingRecipientId = recipientMemberId;
    if (changed && previousRecipientId && !this.#hasDirectTyping(connection.memberId, previousRecipientId)) {
      this.#publishDirectTyping(connection.memberId, previousRecipientId, false);
    }
    if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
    connection.directTypingTimer = recipientMemberId
      ? setTimeout(() => {
          connection.directTypingTimer = null;
          const expiredRecipientId = connection.directTypingRecipientId;
          if (!expiredRecipientId) return;
          connection.directTypingRecipientId = null;
          if (!this.#hasDirectTyping(connection.memberId, expiredRecipientId)) {
            this.#publishDirectTyping(connection.memberId, expiredRecipientId, false);
          }
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.directTypingTimer?.unref?.();
    if (changed && recipientMemberId && !recipientAlreadyActive) {
      this.#publishDirectTyping(connection.memberId, recipientMemberId, true);
    }
  }

  #hasDirectTyping(senderMemberId: string, recipientMemberId: string): boolean {
    return [...this.#eventClients.values()].some(
      (connection) =>
        connection.memberId === senderMemberId && connection.directTypingRecipientId === recipientMemberId,
    );
  }

  #publishPresence(): void {
    const snapshot = this.getPresence();
    this.#options.onPresence?.(snapshot);
    const event: TeamRealtimeEvent = { type: "team-presence", snapshot };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(event, connection.capabilities);
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  #publishDirectMessage(message: DirectMessage): void {
    const memberIds: [string, string] = [message.senderMemberId, message.recipientMemberId];
    const event: DirectMessageRealtimeEvent = {
      type: "team-direct-message",
      message,
      memberIds,
    };
    this.#sendToMembers(memberIds, event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && memberIds.includes(owner.id)) this.#options.onDirectMessage?.(event);
  }

  #publishDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    const event: DirectTypingRealtimeEvent = {
      type: "team-direct-typing",
      senderMemberId,
      recipientMemberId,
      typing,
    };
    this.#sendToMembers([senderMemberId, recipientMemberId], event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && (owner.id === senderMemberId || owner.id === recipientMemberId)) {
      this.#options.onDirectTyping?.(event);
    }
  }

  #sendToMembers(memberIds: string[], event: TeamRealtimeEvent): void {
    const payload = encodeTeamProtocolV1CurrentEvent(event);
    if (!payload) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.capabilities.has("direct-messages") &&
        memberIds.includes(connection.memberId) &&
        client.readyState === webSockets.WebSocket.OPEN
      ) {
        client.send(payload);
      }
    }
  }

  #requireChat(): TeamChatStore {
    if (!this.#options.chat) throw new Error("Direct messages are unavailable.");
    return this.#options.chat;
  }

  /** Concurrent requests with one operation id share one duplication. */
  #duplicateAgent(
    sourceAgentId: string,
    operationId: string,
  ): Effect.Effect<DuplicateAgentResult, AgentDuplicationFailed> {
    return Effect.suspend(() => {
      const committed = this.#options.agents.committedAgentDuplication(operationId, sourceAgentId);
      if (committed) {
        return Effect.succeed({ agent: committed.agent, layout: this.#options.sidebarLayout.getSnapshot() });
      }
      const pending = this.#duplicateRequests.get(operationId);
      if (pending) {
        if (pending.sourceAgentId !== sourceAgentId) {
          return Effect.fail(
            new AgentDuplicationFailed({
              cause: new Error("This agent duplication operation belongs to another source agent."),
            }),
          );
        }
        return Deferred.await(pending.result);
      }
      const result = Deferred.makeUnsafe<DuplicateAgentResult, AgentDuplicationFailed>();
      this.#duplicateRequests.set(operationId, { sourceAgentId, result });
      return duplicateAgentIntoLayout(
        this.#options.agents,
        this.#options.sidebarLayout,
        sourceAgentId,
        operationId,
      ).pipe(
        Effect.onExit((exit) => {
          this.#duplicateRequests.delete(operationId);
          return Deferred.done(result, exit);
        }),
        // The first request owns the operation; the requests that share it wait for its end.
        Effect.uninterruptible,
      );
    });
  }

  #requireDirectRecipient(senderMemberId: string, recipientMemberId: string): TeamMemberSummary {
    if (senderMemberId === recipientMemberId) {
      throw new Error("You cannot open a direct message with yourself.");
    }
    const sender = this.#options.store.getMember(senderMemberId);
    const recipient = this.#options.store.getMember(recipientMemberId);
    if (!sender || sender.disabled) throw new Error("Your team access is unavailable.");
    if (!recipient || recipient.disabled) throw new Error("This team member is unavailable.");
    return recipient;
  }

  #json(response: ServerResponse, status: number, value: object | null): RouteOutcome {
    const route = this.#responseRoutes.get(response);
    if (!route) throw new Error("Team API response route is unavailable.");
    const options = { preserveSemanticTags: supportsTeamSemanticTags(route.capabilities) };
    // The body is encoded before the head is written. A response the negotiated protocol cannot
    // represent - a route its frozen adapter does not classify - makes the encoder throw, and with
    // the headers already sent that throw could neither answer the caller nor end the request: it
    // surfaced as a hung socket and an `ERR_HTTP_HEADERS_SENT` rejection out of `#handle`'s own
    // error path. Encoding first lets that failure become the 500 the caller can read.
    const visibleValue =
      status < 400 && route.hiddenAgentIds
        ? route.protocol < 4
          ? legacyProviderView(value, route.hiddenAgentIds)
          : hiddenAgentView(value, route.hiddenAgentIds, route.protocol < 5 ? 4 : route.protocol < 6 ? 5 : 6)
        : value;
    const sideRoute = teamSideRouteCodec(route.path);
    const body = sideRoute
      ? JSON.stringify(sideRoute.response(route.path, status, visibleValue))
      : teamHttpCodec(route.protocol).encodeResponse(route.method, route.path, status, visibleValue, options);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${body}\n`);
    return "handled";
  }

  /**
   * Agents the negotiated protocol cannot describe, such as a model id a frozen codec does not
   * accept. They are hidden like a provider an old client does not know: one such agent must not
   * turn the whole agent list into a 500, because a remote client then cannot load the server.
   */
  #unrepresentableAgentIds(
    agents: readonly AgentSummary[],
    protocol: number,
    capabilities: ReadonlySet<string>,
  ): Set<string> {
    const codec = teamHttpCodec(protocol);
    const options = { preserveSemanticTags: supportsTeamSemanticTags(capabilities) };
    const hidden = new Set<string>();
    for (const agent of agents) {
      try {
        codec.encodeResponse("GET", TEAM_API_ROUTES.agents.all, 200, [agent], options);
      } catch {
        hidden.add(agent.id);
        const key = `${protocol}:${agent.id}`;
        if (this.#reportedUnrepresentableAgents.has(key)) continue;
        this.#reportedUnrepresentableAgents.add(key);
        (this.#options.logger ?? logger).warn(
          `Team API protocol ${protocol} cannot describe agent ${agent.id}; it is hidden from these clients.`,
        );
      }
    }
    return hidden;
  }

  /** The agents this client cannot see: a provider its protocol does not know, or one it cannot describe. */
  #hiddenAgentIds(protocol: number, capabilities: ReadonlySet<string>): Set<string> {
    const agents = this.#options.agents.listAgents();
    const hidden = hiddenProviderAgentIds(agents, protocol);
    for (const id of this.#unrepresentableAgentIds(
      agents.filter((agent) => !hidden.has(agent.id)),
      protocol,
      capabilities,
    ))
      hidden.add(id);
    return hidden;
  }

  #protocolSupport(): TeamProtocolSupportV1 {
    return {
      appVersion: this.#options.appVersion ?? "0.0.0",
      protocol: { minimum: TEAM_PROTOCOL_V1, maximum: TEAM_PROTOCOL_V6 },
      capabilities: TEAM_CURRENT_CAPABILITIES.filter((capability) => {
        if (capability === "channel-chats-v1" || capability === CHANNEL_DELETE_CAPABILITY)
          return this.#options.channels !== undefined;
        // Advertised only when this host can serve it: a client that negotiated it gets a route,
        // and one that did not never shows the panel.
        if (capability === "remote-desktop-setup")
          return this.#options.remoteScreen?.checkSetup !== undefined && this.#options.remoteScreen?.test !== undefined;
        if (capability === MCP_SERVERS_CAPABILITY) return this.#options.mcpServers !== undefined;
        if (capability === STORAGE_CAPABILITY) return this.#options.storage !== undefined;
        if (capability === HOSTED_SITES_CAPABILITY) return this.#options.hostedSites !== undefined;
        if (capability === AGENT_ADMIN_CAPABILITY) return this.#options.admin?.agents !== undefined;
        if (capability === SKILLS_ADMIN_CAPABILITY) return this.#options.admin?.skills !== undefined;
        if (capability === SKILLS_EVENTS_CAPABILITY) return this.#options.skills !== undefined;
        if (capability === SHARED_TABLES_CAPABILITY) return this.#options.admin?.sharedTables !== undefined;
        if (capability === AGENT_INSTALL_CAPABILITY)
          return (
            this.#options.admin?.marketplaceAgents !== undefined && this.#options.admin?.agentTemplates !== undefined
          );
        if (capability === AGENT_UPDATE_CAPABILITY) return this.#options.admin?.marketplaceAgents !== undefined;
        if (capability === AGENT_PUBLISH_CAPABILITY) return this.#options.admin?.agentTemplates !== undefined;
        if (
          capability === PROVIDERS_ADMIN_CAPABILITY ||
          capability === PROVIDERS_RUNTIMES_V2_CAPABILITY ||
          capability === PROVIDERS_V4_CAPABILITY
        )
          return this.#options.admin?.providers !== undefined;
        if (capability === PROVIDERS_SIGN_IN_V3_CAPABILITY) return this.#options.admin?.providers?.pasteSignIn === true;
        if (capability === HOST_ADMIN_CAPABILITY) return this.#options.admin?.identity !== undefined;
        if (capability === HOST_UPDATE_CAPABILITY) return this.#options.admin?.update !== undefined;
        if (capability === AGENT_IMPORT_CAPABILITY) return this.#options.agentImport !== undefined;
        if (capability === LIVE_ACTIVITY_PUSH_CAPABILITY) return this.#options.liveActivityPush !== undefined;
        return true;
      }),
    };
  }

  #protocolIssue(request: IncomingMessage): TeamProtocolIssue | null {
    if (!this.#options.appVersion) return null;
    const rawProtocol = firstHeaderValue(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()]);
    const clientAppVersion = firstHeaderValue(request.headers[TEAM_APP_VERSION_HEADER.toLowerCase()]);
    const protocol = rawProtocol ? Number(rawProtocol) : null;
    const host = this.#protocolSupport();
    if (!rawProtocol || !clientAppVersion) {
      return {
        status: 426,
        body: {
          error: sourceText("error.team.clientUpdateRequired"),
          code: "client_update_required",
          host,
        },
      };
    }
    if (
      !Number.isSafeInteger(protocol) ||
      protocol === null ||
      protocol < 1 ||
      protocol > 65_535 ||
      clientAppVersion.length > 64
    ) {
      return {
        status: 400,
        body: { error: "Invalid Team API protocol headers.", code: "protocol_error", host },
      };
    }
    if (protocol >= TEAM_PROTOCOL_V1 && protocol <= TEAM_PROTOCOL_V6) return null;
    const clientIsOlder = protocol < TEAM_PROTOCOL_V1;
    return {
      status: 426,
      body: {
        error: clientIsOlder
          ? sourceText("error.team.clientUpdateRequired")
          : sourceText("error.team.hostUpdateRequired"),
        code: clientIsOlder ? "client_update_required" : "host_update_required",
        host,
        client: { appVersion: clientAppVersion, protocol },
      },
    };
  }

  #empty(response: ServerResponse, status: number): RouteOutcome {
    response.writeHead(status);
    response.end();
    return "handled";
  }

  // The context is assembled here rather than in `request-context.ts` because `json` and `empty`
  // have to close over the per-response route record, which only this class holds.
  #requestContext(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token: string,
    authenticated: { member: TeamMemberSummary; sessionId: string; sessionExpiresAt: string },
  ): TeamApiRequestContext {
    return {
      request,
      response,
      method: request.method ?? "GET",
      url,
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
      member: authenticated.member,
      token,
      sessionId: authenticated.sessionId,
      sessionExpiresAt: authenticated.sessionExpiresAt,
      json: (status, value) => this.#json(response, status, value),
      empty: (status) => this.#empty(response, status),
    };
  }
}

function unavailableSidebarLayout(): TeamApiSidebarLayout {
  return {
    getSnapshot: () => ({
      revision: 0,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: [],
    }),
    mutate: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    withProfileAssignment: () =>
      Effect.fail(new StoredStateFailure({ cause: new Error(sourceText("error.team.sidebarLayoutUnavailable")) })),
    placeDuplicateAfter: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    removeAgent: () =>
      Effect.succeed({
        revision: 0,
        sections: [],
        order: ["people", "unassigned"],
        agentAssignments: {},
        agentOrder: [],
      }),
    on: () => undefined,
    off: () => undefined,
  };
}

/** The protocol that an event connection's capabilities describe, as `#encodeProviderEvent` encodes it. */
function eventProtocol(capabilities: ReadonlySet<string>): 1 | 4 | 5 | 6 {
  if (capabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)) return 6;
  return capabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY) ? 5 : capabilities.has("opencode") ? 4 : 1;
}

function eventCapability(event: AgentEvent): TeamCurrentCapability | null {
  if (
    event.type === "channels-changed" ||
    event.type === "channel-memories-changed" ||
    event.type === "channel-routines-changed"
  )
    return "channel-chats-v1";
  if (event.type === "skills-changed") return SKILLS_EVENTS_CAPABILITY;
  if (event.type === "turn-progress") return TEAM_AGENT_ACTIVITY_CAPABILITY;
  if (event.type === "runtime-snapshot") return "agent-runtime-snapshots";
  if (event.type === "sidebar-layout-changed") return "sidebar-layout";
  if (event.type === "browser-changed" || event.type === "browser-control-changed") return "browser-control";
  if (event.type === "conversation-page") return "conversation-pagination";
  return null;
}
