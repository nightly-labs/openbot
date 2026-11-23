import type {
  AgentEvent,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  ServerCompatibility,
  ServerSummary,
  TeamPresenceSnapshot,
} from "@openbot/contracts/ipc";
import { decodeRecord } from "@openbot/contracts/ipc-decoding";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  supportsTeamCapability,
  type TeamCurrentCapability,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import type { HostAppearanceEvent } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { HostRestartEvent } from "@openbot/contracts/team-protocol/host-update-v1";
import type { LiveVoiceEvent } from "@openbot/contracts/team-protocol/live-voice-v1";
import type { MachineAlertEvent } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { addSkillSuggestionNames, SKILL_LEARNING_CAPABILITY } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { TEAM_PROTOCOL_V1_WEBSOCKET } from "@openbot/contracts/team-protocol/v1";
import {
  encodeTeamProtocolV1CurrentClientEvent,
  type TeamProtocolV1CurrentClientEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { decodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import { sourceText } from "@openbot/i18n/source";
import { referenceFrom } from "@openbot/user-errors";
import { Effect, Exit, Result, Scope } from "effect";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { requestJson } from "./remote-server-http";
import type { RemoteServerDirectory, StoredRemoteServerView } from "./remote-server-store";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";

const REMOTE_EVENT_RECONNECT_BASE_MS = 1_000;
const REMOTE_EVENT_RECONNECT_MAX_MS = 60_000;
const REMOTE_EVENT_RECONNECT_JITTER = 0.2;
const REMOTE_HOST_OFFLINE_RETRY_MS = 5 * 60_000;
const REMOTE_HOST_OFFLINE_UNFOCUSED_RETRY_MS = 15 * 60_000;
const REMOTE_HOST_RECENTLY_ONLINE_MS = 10 * 60_000;
const HOSTED_SERVER_START_RETRY_MS = 5_000;
const REMOTE_EVENT_HEALTHY_MS = 30_000;
const REMOTE_EVENT_PAYLOAD_LIMIT = 1024 * 1024;
const REMOTE_EVENT_INITIAL_BUFFER_LIMIT = 1_000;
const REMOTE_EVENT_PROTOCOL = "openbot-events";
const REMOTE_EVENT_SNAPSHOT_PROTOCOL = "openbot-events-v2";

export interface RemoteEventCompatibilitySource {
  ensureCompatibility(
    server: StoredRemoteServerView,
    refresh?: boolean,
  ): Effect.Effect<ServerCompatibility, RemoteWorkflowError>;
  requestProtocol(compatibility: ServerCompatibility): {
    protocol?: number | undefined;
    appVersion?: string | undefined;
    capabilities?: readonly TeamCurrentCapability[] | undefined;
    preserveSemanticTags?: boolean | undefined;
  };
}

export interface RemoteEventConnectionSink {
  markConnected(serverId: string): void;
  setState(serverId: string, state: ServerSummary["state"]): void;
  setCompatibility(serverId: string, compatibility: ServerCompatibility): void;
  compatibilityFor(serverId: string): ServerCompatibility | null;
  reportError(serverId: string, error: unknown): void;
  reportUnreachable(serverId: string, reference?: string): void;
}

export interface RemoteEventAgentState {
  refreshAgentState(serverId: string): Effect.Effect<void, RemoteWorkflowError>;
  forward(serverId: string, event: AgentEvent, bufferedLive?: boolean): Effect.Effect<void, RemoteWorkflowError>;
}

export interface RemoteEventLiveTransport {
  connect(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
  retry(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
  requestRuntimeSnapshot(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
}

export interface RemoteEventStreamOptions {
  appVersion: string | null;
  servers: RemoteServerDirectory;
  client: RemoteEventCompatibilitySource;
  connections: RemoteEventConnectionSink;
  agents: RemoteEventAgentState;
  transport: RemoteEventLiveTransport | null;
  onServerIdentity: (serverId: string, identity: { serverName: string; logoVersion: string | null }) => void;
  onPresence: (serverId: string, snapshot: TeamPresenceSnapshot) => void;
  onDirectMessage: (serverId: string, event: DirectMessageRealtimeEvent) => void;
  onDirectTyping: (serverId: string, event: DirectTypingRealtimeEvent) => void;
  onHostRestart: (serverId: string, event: HostRestartEvent) => void;
  onHostAppearance: (serverId: string, event: HostAppearanceEvent) => void;
  onMachineAlert: (serverId: string, event: MachineAlertEvent) => void;
  onLiveVoice: (serverId: string, event: LiveVoiceEvent) => void;
  onOffline: (serverId: string) => void;
  onChanged: () => void;
}

export class RemoteEventStream {
  readonly #scope = Scope.makeUnsafe();
  readonly #appVersion: string | null;
  readonly #servers: RemoteServerDirectory;
  #chatWindowServerIds: ReadonlySet<string> = new Set();
  readonly #client: RemoteEventCompatibilitySource;
  readonly #connections: RemoteEventConnectionSink;
  readonly #agents: RemoteEventAgentState;
  readonly #transport: RemoteEventLiveTransport | null;
  readonly #onServerIdentity: RemoteEventStreamOptions["onServerIdentity"];
  readonly #onPresence: RemoteEventStreamOptions["onPresence"];
  readonly #onDirectMessage: RemoteEventStreamOptions["onDirectMessage"];
  readonly #onDirectTyping: RemoteEventStreamOptions["onDirectTyping"];
  readonly #onHostRestart: RemoteEventStreamOptions["onHostRestart"];
  readonly #onHostAppearance: RemoteEventStreamOptions["onHostAppearance"];
  readonly #onMachineAlert: RemoteEventStreamOptions["onMachineAlert"];
  readonly #onLiveVoice: RemoteEventStreamOptions["onLiveVoice"];
  readonly #onOffline: RemoteEventStreamOptions["onOffline"];
  readonly #onChanged: RemoteEventStreamOptions["onChanged"];
  readonly #controllers = new Map<string, AbortController>();
  readonly #sockets = new Map<string, WebSocket>();
  readonly #reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #reconnectAttempts = new Map<string, number>();
  readonly #transportAttempts = new Set<string>();
  readonly #authenticationPaused = new Set<string>();
  readonly #offlineHosts = new Map<string, number>();
  readonly #seenOnlineAt = new Map<string, number>();
  readonly #transportConnectedAt = new Map<string, number>();
  readonly #transportDrops = new Map<string, number>();
  readonly #startingHosts = new Set<string>();
  #appFocused = true;
  #enabled = false;

  constructor(options: RemoteEventStreamOptions) {
    this.#appVersion = options.appVersion;
    this.#servers = options.servers;
    this.#client = options.client;
    this.#connections = options.connections;
    this.#agents = options.agents;
    this.#transport = options.transport;
    this.#onServerIdentity = options.onServerIdentity;
    this.#onPresence = options.onPresence;
    this.#onDirectMessage = options.onDirectMessage;
    this.#onDirectTyping = options.onDirectTyping;
    this.#onHostRestart = options.onHostRestart;
    this.#onHostAppearance = options.onHostAppearance;
    this.#onMachineAlert = options.onMachineAlert;
    this.#onLiveVoice = options.onLiveVoice;
    this.#onOffline = options.onOffline;
    this.#onChanged = options.onChanged;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  readonly start = Effect.fn("RemoteEventStream.start")(function* (this: RemoteEventStream) {
    this.#enabled = true;
    for (const server of this.#servers.servers) yield* this.ensure(server.id);
  }).bind(this);

  readonly stop = Effect.fn("RemoteEventStream.stop")(function* (this: RemoteEventStream) {
    this.#enabled = false;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    for (const timer of this.#reconnectTimers.values()) clearTimeout(timer);
    this.#reconnectTimers.clear();
    this.#reconnectAttempts.clear();
    this.#offlineHosts.clear();
    this.#seenOnlineAt.clear();
    this.#transportConnectedAt.clear();
    this.#transportDrops.clear();
    this.#transportAttempts.clear();
    this.#authenticationPaused.clear();
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  readonly refreshRuntimeSnapshots = Effect.fn("RemoteEventStream.refreshRuntimeSnapshots")(function* (
    this: RemoteEventStream,
  ) {
    for (const server of this.#servers.servers) {
      if (server.transport === "webrtc-v2") {
        const transport = this.#transport;
        if (transport)
          yield* Effect.forkIn(
            transport.requestRuntimeSnapshot(server.id).pipe(Effect.catch(() => Effect.void)),
            this.#scope,
            { startImmediately: true },
          );
        continue;
      }
      const socket = this.#sockets.get(server.id);
      if (socket?.readyState !== WebSocket.OPEN) {
        yield* this.ensure(server.id);
        continue;
      }
      if (this.#supportsRuntimeSnapshots(server.id, socket)) {
        socket.send(encodeTeamProtocolV1CurrentClientEvent({ type: "runtime-snapshot-request" }));
      } else {
        yield* Effect.forkIn(
          this.#agents.refreshAgentState(server.id).pipe(Effect.catch(() => Effect.void)),
          this.#scope,
          { startImmediately: true },
        );
      }
    }
  }).bind(this);

  send(serverId: string, event: TeamProtocolV1CurrentClientEvent): void {
    const socket = this.#sockets.get(serverId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeTeamProtocolV1CurrentClientEvent(event));
  }

  syncScopes(): void {
    for (const [serverId, socket] of this.#sockets) this.#sendEventScope(serverId, socket);
  }

  setChatWindowServers(serverIds: ReadonlySet<string>): void {
    this.#chatWindowServerIds = serverIds;
    this.syncScopes();
  }

  transportConnected(serverId: string): void {
    this.#cancelPendingReconnect(serverId);
    const drops = this.#transportDrops.get(serverId);
    if (drops) this.#reconnectAttempts.set(serverId, drops);
    else this.#reconnectAttempts.delete(serverId);
    this.#transportConnectedAt.set(serverId, Date.now());
  }

  transportDisconnected(serverId: string): boolean {
    const connectedAt = this.#transportConnectedAt.get(serverId);
    this.#transportConnectedAt.delete(serverId);
    if (connectedAt === undefined) return !this.#transportDrops.has(serverId);
    if (Date.now() - connectedAt >= REMOTE_EVENT_HEALTHY_MS) {
      this.#transportDrops.delete(serverId);
      this.#reconnectAttempts.delete(serverId);
      return true;
    }
    const drops = (this.#transportDrops.get(serverId) ?? 0) + 1;
    this.#transportDrops.set(serverId, drops);
    return drops === 1;
  }

  clearReconnectBackoff(serverId: string): void {
    this.#cancelPendingReconnect(serverId);
    this.#reconnectAttempts.delete(serverId);
    this.#transportDrops.delete(serverId);
  }

  #cancelPendingReconnect(serverId: string): void {
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    this.#offlineHosts.delete(serverId);
    this.#startingHosts.delete(serverId);
  }

  setHostStarting(serverId: string, starting: boolean): void {
    if (!starting) {
      this.#startingHosts.delete(serverId);
      return;
    }
    this.#startingHosts.add(serverId);
    this.#offlineHosts.delete(serverId);
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    this.scheduleReconnect(serverId);
  }

  isHostOffline(serverId: string): boolean {
    return this.#offlineHosts.has(serverId);
  }

  markSeenOnline(serverId: string): void {
    this.#seenOnlineAt.set(serverId, Date.now());
  }

  markHostOffline(serverId: string): void {
    this.#offlineHosts.set(serverId, Date.now());
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    this.scheduleReconnect(serverId);
  }

  readonly setAppFocused = Effect.fn("RemoteEventStream.setAppFocused")(function* (
    this: RemoteEventStream,
    focused: boolean,
  ) {
    this.#appFocused = focused;
    if (focused) yield* this.retryOfflineHosts();
  }).bind(this);

  readonly wake = Effect.fn("RemoteEventStream.wake")(function* (this: RemoteEventStream) {
    if (!this.#enabled) return;
    for (const server of this.#servers.servers) {
      if (this.#authenticationPaused.has(server.id)) continue;
      this.clearReconnectBackoff(server.id);
      if (server.transport === "webrtc-v2") yield* this.ensure(server.id, true);
      else yield* this.restart(server.id);
    }
  }).bind(this);

  readonly retryNow = Effect.fn("RemoteEventStream.retryNow")(function* (this: RemoteEventStream, serverId: string) {
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (!reconnectTimer || this.#authenticationPaused.has(serverId)) return;
    clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    this.#offlineHosts.delete(serverId);
    yield* this.ensure(serverId);
  }).bind(this);

  readonly retryOfflineHosts = Effect.fn("RemoteEventStream.retryOfflineHosts")(function* (this: RemoteEventStream) {
    const now = Date.now();
    for (const [serverId, markedAt] of this.#offlineHosts) {
      if (now - markedAt < REMOTE_EVENT_RECONNECT_MAX_MS) continue;
      this.#offlineHosts.delete(serverId);
      const reconnectTimer = this.#reconnectTimers.get(serverId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      this.#reconnectTimers.delete(serverId);
      yield* this.ensure(serverId);
    }
  }).bind(this);

  isReconnectSuspended(serverId: string): boolean {
    return this.#authenticationPaused.has(serverId);
  }

  resumeReconnect(serverId: string): void {
    this.#authenticationPaused.delete(serverId);
    this.clearReconnectBackoff(serverId);
  }

  suspendReconnect(serverId: string): void {
    this.#authenticationPaused.add(serverId);
    this.#controllers.get(serverId)?.abort();
    this.#controllers.delete(serverId);
    this.#sockets.delete(serverId);
  }

  forget(serverId: string): void {
    this.#controllers.get(serverId)?.abort();
    this.#controllers.delete(serverId);
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    this.#reconnectAttempts.delete(serverId);
    this.#offlineHosts.delete(serverId);
    this.#seenOnlineAt.delete(serverId);
    this.#transportConnectedAt.delete(serverId);
    this.#transportDrops.delete(serverId);
    this.#startingHosts.delete(serverId);
    this.#authenticationPaused.delete(serverId);
    this.#sockets.delete(serverId);
  }

  readonly ensure = Effect.fn("RemoteEventStream.ensure")(function* (
    this: RemoteEventStream,
    serverId: string,
    checkLiveConnection = false,
  ) {
    const server = this.#servers.find(serverId);
    if (server?.transport === "webrtc-v2") {
      if (
        !this.#enabled ||
        this.#reconnectTimers.has(serverId) ||
        this.#authenticationPaused.has(serverId) ||
        this.#transportAttempts.has(serverId)
      )
        return;
      this.#transportAttempts.add(serverId);
      const transport = this.#transport;
      if (transport)
        yield* Effect.forkIn(
          (checkLiveConnection ? transport.retry(serverId) : transport.connect(serverId)).pipe(
            Effect.catch(() => Effect.sync(() => this.scheduleReconnect(serverId))),
            Effect.ensuring(
              Effect.sync(() => {
                this.#transportAttempts.delete(serverId);
              }),
            ),
          ),
          this.#scope,
          { startImmediately: true },
        );
      return;
    }
    if (
      !server ||
      !this.#enabled ||
      this.#controllers.has(serverId) ||
      this.#reconnectTimers.has(serverId) ||
      this.#authenticationPaused.has(serverId)
    ) {
      return;
    }
    yield* Effect.forkIn(this.#connectEvents(serverId), this.#scope, { startImmediately: true });
  }).bind(this);

  readonly restart = Effect.fn("RemoteEventStream.restart")(function* (
    this: RemoteEventStream,
    serverId: string,
    resetBackoff = false,
  ) {
    this.#controllers.get(serverId)?.abort();
    this.#controllers.delete(serverId);
    const reconnectTimer = this.#reconnectTimers.get(serverId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(serverId);
    if (resetBackoff) this.resumeReconnect(serverId);
    yield* this.ensure(serverId);
  }).bind(this);

  scheduleReconnect(serverId: string): void {
    if (!this.#enabled || this.#reconnectTimers.has(serverId)) return;
    if (!this.#servers.has(serverId)) return;
    if (this.#authenticationPaused.has(serverId)) return;
    const attempt = (this.#reconnectAttempts.get(serverId) ?? 0) + 1;
    this.#reconnectAttempts.set(serverId, attempt);
    const seenOnlineAt = this.#seenOnlineAt.get(serverId);
    const recentlyOnline = seenOnlineAt !== undefined && Date.now() - seenOnlineAt < REMOTE_HOST_RECENTLY_ONLINE_MS;
    const hostOffline = this.#offlineHosts.has(serverId) && !recentlyOnline;
    const offlineDelay = this.#appFocused ? REMOTE_HOST_OFFLINE_RETRY_MS : REMOTE_HOST_OFFLINE_UNFOCUSED_RETRY_MS;
    const maximumDelay = hostOffline ? offlineDelay : REMOTE_EVENT_RECONNECT_MAX_MS;
    const exponentialDelay = hostOffline
      ? offlineDelay
      : Math.min(REMOTE_EVENT_RECONNECT_MAX_MS, REMOTE_EVENT_RECONNECT_BASE_MS * 2 ** (attempt - 1));
    const jitter = exponentialDelay * REMOTE_EVENT_RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = this.#startingHosts.has(serverId)
      ? HOSTED_SERVER_START_RETRY_MS
      : Math.min(maximumDelay, Math.max(REMOTE_EVENT_RECONNECT_BASE_MS, Math.round(exponentialDelay + jitter)));
    const timer = setTimeout(() => {
      this.#reconnectTimers.delete(serverId);
      this.#offlineHosts.delete(serverId);
      void Effect.runPromise(this.ensure(serverId)).catch(() => undefined);
    }, delay);
    this.#reconnectTimers.set(serverId, timer);
  }

  readonly #connectEvents = Effect.fn("RemoteEventStream.connectEvents")(function* (
    this: RemoteEventStream,
    serverId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.#enabled || this.#controllers.has(serverId)) return;
    const server = yield* remoteDecode(() => this.#servers.require(serverId));
    if (server.transport === "webrtc-v2") return;
    const controller = new AbortController();
    this.#controllers.set(serverId, controller);
    let opened = false;
    let openedAt = 0;
    let authenticationFailed = false;
    let protocolFailed = false;
    const closed: { code?: number } = {};
    const attempt0 = yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* this.#client.ensureCompatibility(server, true);
      if (controller.signal.aborted || !this.#enabled || !this.#servers.has(serverId)) {
        if (this.#controllers.get(serverId) === controller) this.#controllers.delete(serverId);
        return;
      }
      const eventsUrl = new URL(TEAM_API_ROUTES.events, server.apiUrl);
      eventsUrl.protocol = eventsUrl.protocol === "https:" ? "wss:" : "ws:";
      const socketProtocols = this.#appVersion
        ? [TEAM_PROTOCOL_V1_WEBSOCKET, `openbot-token.${this.#servers.token(server)}`]
        : [REMOTE_EVENT_SNAPSHOT_PROTOCOL, REMOTE_EVENT_PROTOCOL, `openbot-token.${this.#servers.token(server)}`];
      const socket = yield* remoteDecode(() => new WebSocket(eventsUrl, socketProtocols));
      let agentEventsReady = false;
      const bufferedAgentEvents: AgentEvent[] = [];
      const abort = () => socket.close(1000, "Client stopped");
      controller.signal.addEventListener("abort", abort, {
        once: true,
      });
      yield* Effect.callback<void, RemoteWorkflowError>((resume) => {
        const resolve = () => resume(Effect.void);
        const reject = (cause: unknown) => resume(Effect.fail(new RemoteWorkflowError({ cause })));
        socket.addEventListener(
          "open",
          () => {
            opened = true;
            openedAt = Date.now();
            this.#sockets.set(serverId, socket);
            this.#sendEventScope(serverId, socket);
            this.#connections.markConnected(serverId);
            this.#connections.setCompatibility(serverId, compatibility);
            this.#authenticationPaused.delete(serverId);
            this.#onChanged();
            if (this.#supportsRuntimeSnapshots(serverId, socket)) {
              agentEventsReady = true;
            } else {
              void Effect.runPromise(
                Effect.forkIn(
                  Effect.gen({ self: this }, function* () {
                    yield* this.#agents.refreshAgentState(serverId);
                    if (this.#sockets.get(serverId) !== socket) return;
                    agentEventsReady = true;
                    for (const event of bufferedAgentEvents) yield* this.#agents.forward(serverId, event, true);
                    bufferedAgentEvents.length = 0;
                  }).pipe(
                    Effect.catch(() => Effect.sync(() => socket.close(1000, "Initial agent state is unavailable"))),
                  ),
                  this.#scope,
                ),
              ).catch(() => undefined);
            }
          },
          { once: true },
        );
        socket.addEventListener("message", (message) => {
          if (!isString(message.data)) {
            protocolFailed = true;
            this.#connections.reportError(
              serverId,
              new RemoteProtocolError("protocol_error", sourceText("error.remote.binaryEvent")),
            );
            socket.close(1000, "Text event payloads are required");
            return;
          }
          if (Buffer.byteLength(message.data) > REMOTE_EVENT_PAYLOAD_LIMIT) {
            protocolFailed = true;
            this.#connections.reportError(
              serverId,
              new RemoteProtocolError("protocol_error", sourceText("error.remote.eventTooLarge")),
            );
            socket.close(1000, "Event payload is too large");
            return;
          }
          try {
            const value = JSON.parse(message.data);
            const optional = optionalTeamEvent(value, { agentTaskUiBlocks: true });
            const decoded = optional
              ? { kind: "known" as const, event: optionalTeamEventToCurrent(optional) }
              : decodeTeamProtocolV8BaseCurrentEvent(value);
            if (decoded.kind === "unknown") return;
            if (decoded.kind === "invalid") {
              protocolFailed = true;
              this.#connections.reportError(
                serverId,
                new RemoteProtocolError("protocol_error", sourceText("error.remote.invalidKnownEvent")),
              );
              socket.close(1000, "Invalid known event payload");
              return;
            }
            const event = decoded.event;
            if (this.#advertises(serverId, SKILL_LEARNING_CAPABILITY)) addSkillSuggestionNames(event, value);
            if (event.type === "team-identity") {
              this.#onServerIdentity(serverId, { serverName: event.serverName, logoVersion: event.logoVersion });
            } else if (event.type === "team-presence") {
              this.#onPresence(serverId, event.snapshot);
            } else if (event.type === "team-direct-message") {
              this.#onDirectMessage(serverId, event);
            } else if (event.type === "team-direct-typing") {
              this.#onDirectTyping(serverId, event);
            } else if (event.type === "host-restart") {
              this.#onHostRestart(serverId, event);
            } else if (event.type === "host-appearance") {
              this.#onHostAppearance(serverId, event);
            } else if (event.type === "machine-alert") {
              this.#onMachineAlert(serverId, event);
            } else if (event.type === "live-voice") {
              this.#onLiveVoice(serverId, event);
            } else if (event.type === "client-browser-command") {
              // This client does not share Chrome tabs (`client-browser-v1`), so no host sends it a command.
            } else {
              if (!agentEventsReady) {
                if (bufferedAgentEvents.length >= REMOTE_EVENT_INITIAL_BUFFER_LIMIT) {
                  socket.close(1000, "Initial agent event buffer is full");
                  return;
                }
                bufferedAgentEvents.push(event);
              } else {
                void Effect.runPromise(
                  Effect.forkIn(this.#agents.forward(serverId, event), this.#scope, { startImmediately: true }),
                ).catch(() => undefined);
              }
            }
          } catch {
            protocolFailed = true;
            this.#connections.reportError(
              serverId,
              new RemoteProtocolError("protocol_error", sourceText("error.remote.invalidJson")),
            );
            socket.close(1000, "Invalid event payload");
          }
        });
        socket.addEventListener(
          "error",
          () => {
            socket.close(1000, "Remote events are unavailable");
            reject(new Error(sourceText("error.remote.eventsUnavailable")));
          },
          { once: true },
        );
        socket.addEventListener(
          "close",
          (event) => {
            closed.code = event.code;
            if (this.#sockets.get(serverId) === socket) {
              this.#sockets.delete(serverId);
            }
            resolve();
          },
          { once: true },
        );
        return Effect.sync(() => {
          controller.signal.removeEventListener("abort", abort);
          socket.close(1000, "Client stopped");
        });
      });
      if (!controller.signal.aborted && !protocolFailed) {
        this.#connections.setState(serverId, "offline");
        this.#onOffline(serverId);
        this.#onChanged();
      }
    }).pipe(Effect.result);
    if (Result.isFailure(attempt0)) {
      const error = attempt0.failure.cause;
      if (!controller.signal.aborted) {
        if (error instanceof RemoteProtocolError) {
          protocolFailed = true;
          this.#connections.reportError(serverId, error);
        } else {
          const refused = opened ? null : yield* this.#eventCredentialsRefusalEffect(server);
          authenticationFailed = refused !== null && (refused.status === 401 || refused.status === 403);
          if (authenticationFailed) {
            this.#connections.reportError(
              serverId,
              new RemoteRequestError(
                401,
                sourceText("error.remote.signInAgain"),
                null,
                referenceFrom("http", refused?.status, refused?.code),
              ),
            );
          } else {
            this.#connections.reportUnreachable(
              serverId,
              (refused ? referenceFrom("http", refused.status, refused.code) : null) ??
                (closed.code === undefined ? undefined : `ws/close/${closed.code}`),
            );
            this.#onOffline(serverId);
            this.#onChanged();
          }
        }
      }
    }
    if (this.#controllers.get(serverId) === controller) this.#controllers.delete(serverId);
    if (openedAt > 0 && Date.now() - openedAt >= REMOTE_EVENT_HEALTHY_MS) {
      this.#reconnectAttempts.delete(serverId);
    }
    if (!controller.signal.aborted && !authenticationFailed && !protocolFailed) this.scheduleReconnect(serverId);
  });

  #sendEventScope(serverId: string, socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (
      this.#appVersion
        ? socket.protocol !== TEAM_PROTOCOL_V1_WEBSOCKET
        : !this.#supportsRuntimeSnapshots(serverId, socket)
    ) {
      return;
    }
    socket.send(
      encodeTeamProtocolV1CurrentClientEvent({
        type: "agent-event-scope",
        includeConversations: this.#servers.activeServerId === serverId || this.#chatWindowServerIds.has(serverId),
        ...(this.#appVersion
          ? {
              capabilities: teamCapabilitiesForProtocol(
                this.#connections.compatibilityFor(serverId)?.negotiatedProtocol,
              ),
            }
          : {}),
      }),
    );
  }

  readonly #eventCredentialsRefusalEffect = Effect.fn("RemoteEventStream.eventCredentialsRefusal")(function* (
    this: RemoteEventStream,
    server: StoredRemoteServerView,
  ): Effect.fn.Return<RemoteRequestError | null, RemoteWorkflowError> {
    return yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* this.#client.ensureCompatibility(server);
      yield* requestJson(server.apiUrl, TEAM_API_ROUTES.me, (value) => decodeRecord(value, "team member"), {
        token: this.#servers.token(server),
        ...this.#client.requestProtocol(compatibility),
      }).pipe(
        Effect.mapError(
          (error) =>
            new RemoteWorkflowError({
              cause: error instanceof RemoteRequestError || error instanceof RemoteProtocolError ? error : error.cause,
            }),
        ),
      );
      return null;
    }).pipe(Effect.catch(({ cause: error }) => Effect.succeed(error instanceof RemoteRequestError ? error : null)));
  });

  #advertises(serverId: string, capability: TeamCurrentCapability): boolean {
    if (!this.#appVersion) return false;
    return supportsTeamCapability(
      teamCapabilitiesForProtocol(this.#connections.compatibilityFor(serverId)?.negotiatedProtocol),
      capability,
    );
  }

  #supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean {
    const capabilities = this.#connections.compatibilityFor(serverId)?.capabilities;
    return capabilities ? supportsTeamCapability(capabilities, capability) : false;
  }

  #supportsRuntimeSnapshots(serverId: string, socket: WebSocket): boolean {
    return this.#appVersion
      ? this.#supportsCapability(serverId, "agent-runtime-snapshots")
      : socket.protocol === REMOTE_EVENT_SNAPSHOT_PROTOCOL;
  }
}
