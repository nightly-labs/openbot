import { createHash, randomBytes, verify } from "node:crypto";
import { openAsBlob } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { browserViewStreamSessionId } from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  supportsTeamSemanticTags,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
} from "@openbot/contracts/team-protocol/current";
import { optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { encodeTeamProtocolV1ClientEvent } from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2AuthFrame,
  type TeamProtocolV2Json,
  type TeamProtocolV2RpcFrame,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol/v2";
import { createTeamProtocolV2Event } from "@openbot/contracts/team-protocol/v2-adapter";
import {
  decodeTeamProtocolV3WebRtcHttpRequest,
  encodeTeamProtocolV3WebRtcHttpResponse,
  isTeamProtocolV3OnlyRoute,
} from "@openbot/contracts/team-protocol/v3-webrtc-adapter";
import {
  createTeamProtocolV4Event,
  decodeTeamProtocolV4WebRtcHttpRequest,
  encodeTeamProtocolV4WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v4-webrtc-adapter";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v5";
import {
  createTeamProtocolV5Event,
  decodeTeamProtocolV5WebRtcHttpRequest,
  encodeTeamProtocolV5WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v5-webrtc-adapter";
import { TEAM_CURSOR_CLINE_CAPABILITY } from "@openbot/contracts/team-protocol/v6";
import {
  createTeamProtocolV6Event,
  decodeTeamProtocolV6WebRtcHttpRequest,
  encodeTeamProtocolV6WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v6-webrtc-adapter";
import { TEAM_PI_MUSE_CAPABILITY } from "@openbot/contracts/team-protocol/v7";
import {
  createTeamProtocolV7Event,
  decodeTeamProtocolV7WebRtcHttpRequest,
  encodeTeamProtocolV7WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v7-webrtc-adapter";
import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime } from "effect";
import type * as Ws from "ws";
import type { VerifiedRemoteSessionTicket } from "./central-auth-manager";
import { contentDispositionFileName } from "./content-disposition";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "./remote-desktop-signal";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";
import type { TeamStore } from "./team-store";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { type ReceivedWebRtcFile, TeamWebRtcFileTransfer } from "./team-webrtc-file-transfer";
import { rawDataBytes, sendableCloseCode } from "./ws-raw-data";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));
const MAXIMUM_BUFFERED_EVENTS = 2_000;
/** A Moonlight session and a few browser views, which is more than a member watches at once. */
const MAXIMUM_DESKTOP_STREAMS = 6;

export interface TeamWebRtcHostPeerOptions {
  bridge: TeamWebRtcBridge;
  store: TeamStore;
  appVersion: string;
  transferDirectory: string;
  closeSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  verifyClientTicket?: (ticket: string) => Effect.Effect<VerifiedRemoteSessionTicket, RemoteWorkflowError>;
}

export interface IncomingConnection {
  hostId: string;
  connectionId: string;
  sessionId: string;
  userId: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  sessionExpiresAt: number;
}

class HostPeerTransport extends Context.Service<
  HostPeerTransport,
  {
    send(...args: Parameters<TeamWebRtcBridge["send"]>): Effect.Effect<void, RemoteWorkflowError>;
    fetch(input: URL, init: RequestInit): Effect.Effect<Response, RemoteWorkflowError>;
  }
>()("openbot/main/HostPeerTransport") {}

export class TeamWebRtcHostPeer {
  readonly #bridge: TeamWebRtcBridge;
  readonly #runtime: ManagedRuntime.ManagedRuntime<HostPeerTransport, never>;
  readonly #operations = new Set<Fiber.Fiber<void, RemoteWorkflowError>>();
  readonly #closingSessions = new Set<Fiber.Fiber<void>>();
  #disposal: Fiber.Fiber<void> | null = null;
  readonly #store: TeamStore;
  readonly #appVersion: string;
  readonly #files: TeamWebRtcFileTransfer;
  readonly #closeSession: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  readonly #verifyClientTicket:
    | ((ticket: string) => Effect.Effect<VerifiedRemoteSessionTicket, RemoteWorkflowError>)
    | null;
  readonly #responses = new Map<string, TeamProtocolV2RpcFrame>();
  readonly #responsesInFlight = new Map<string, Fiber.Fiber<TeamProtocolV2RpcFrame, RemoteWorkflowError>>();
  readonly #events = new Map<number, string>();
  #peerCapabilities = new Set<string>();
  #peerId: string | null = null;
  readonly #hostId: string;
  #localApiPort: number | null = null;
  #localSessionToken: string | null = null;
  #localSessionId: string | null = null;
  #eventsSocket: Ws.WebSocket | null = null;
  #eventsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #eventsReconnectAttempts = 0;
  #nextEventSequence = 1;
  readonly #desktopSockets = new Map<string, Ws.WebSocket>();
  #sessionExpirationTimer: ReturnType<typeof setTimeout> | null = null;
  #sessionPreparation: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #pendingConnection: IncomingConnection | null = null;
  #peerBinding: { localFingerprint: string; remoteFingerprint: string } | null = null;
  #sessionBinding: { localFingerprint: string; remoteFingerprint: string } | null = null;
  #authenticationCompletion: {
    claims: VerifiedRemoteSessionTicket;
    clientNonce: string;
    hostNonce: string;
  } | null = null;

  constructor(options: TeamWebRtcHostPeerOptions, input: { peerId: string; hostId: string; localApiPort: number }) {
    this.#peerId = input.peerId;
    this.#hostId = input.hostId;
    this.#localApiPort = input.localApiPort;
    this.#bridge = options.bridge;
    this.#runtime = ManagedRuntime.make(
      Layer.succeed(
        HostPeerTransport,
        HostPeerTransport.of({
          send: (...args) => options.bridge.send(...args),
          fetch: (input, init) =>
            Effect.tryPromise({
              try: (signal) => fetch(input, { ...init, signal }),
              catch: (cause) => new RemoteWorkflowError({ cause }),
            }),
        }),
      ),
    );
    this.#store = options.store;
    this.#appVersion = options.appVersion;
    this.#files = new TeamWebRtcFileTransfer(
      options.bridge,
      join(options.transferDirectory, createHash("sha256").update(input.peerId).digest("hex")),
      undefined,
      (peerId) => peerId === this.#peerId && this.#localSessionToken !== null,
    );
    this.#closeSession = options.closeSession ?? (() => Effect.void);
    this.#verifyClientTicket = options.verifyClientTicket ?? null;
    this.#bridge.on("connected", this.#onConnected);
    this.#bridge.on("data", this.#onData);
    this.#bridge.on("disconnected", this.#onDisconnected);
  }

  readonly revokeSession = Effect.fn("TeamHostPeer.revokeSession")(function* (
    this: TeamWebRtcHostPeer,
    sessionId: string,
  ) {
    if (sessionId !== this.#localSessionId && sessionId !== this.#pendingConnection?.sessionId) return;
    const peerId = this.#peerId;
    // An RPC can revoke itself. Start disposal without waiting for that RPC's response.
    yield* this.#beginDisposal();
    if (peerId) yield* this.#bridge.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
  }).bind(this);

  /** Whether this device has a file transfer moving right now, either direction. */
  hasActiveTransfers(): boolean {
    return this.#files.hasActiveTransfers();
  }

  // Execution is limited to native bridge and WebSocket callbacks.
  #dispatch(operation: Effect.Effect<void, RemoteWorkflowError, HostPeerTransport>): void {
    const fiber = this.#runtime.runFork(operation);
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  }

  readonly dispose = Effect.fn("TeamHostPeer.dispose")(function* (this: TeamWebRtcHostPeer) {
    const fiber = yield* this.#beginDisposal();
    yield* Fiber.join(fiber);
  }, Effect.uninterruptible).bind(this);

  readonly #beginDisposal = Effect.fn("TeamHostPeer.beginDisposal")(function* (this: TeamWebRtcHostPeer) {
    if (this.#disposal) return this.#disposal;
    this.#bridge.off("connected", this.#onConnected);
    this.#bridge.off("data", this.#onData);
    this.#bridge.off("disconnected", this.#onDisconnected);
    // Transport teardown must not revoke a logical session resumed by another peer.
    yield* this.#closeLocalSession(false);
    this.#peerId = null;
    this.#pendingConnection = null;
    this.#peerBinding = null;
    const disposal = yield* Effect.forkDetach(
      Effect.gen({ self: this }, function* () {
        yield* this.#files.stop().pipe(Effect.catch(() => Effect.void));
        yield* Fiber.awaitAll([...this.#operations, ...this.#closingSessions]);
        yield* this.#runtime.disposeEffect;
      }),
      { startImmediately: false },
    );
    this.#disposal = disposal;
    return disposal;
  }, Effect.uninterruptible);

  readonly incoming = Effect.fn("TeamHostPeer.incoming")(function* (
    this: TeamWebRtcHostPeer,
    connection: IncomingConnection,
  ) {
    if (!this.#peerId || connection.hostId !== this.#hostId) return;
    if (connection.sessionId === this.#localSessionId && this.#localSessionToken) {
      this.#pendingConnection = connection;
      return;
    }
    yield* this.#closeLocalSession();
    this.#pendingConnection = connection;
  }).bind(this);

  readonly #onConnected = (peerId: string, binding?: { localFingerprint: string; remoteFingerprint: string }): void => {
    if (peerId !== this.#peerId) return;
    this.#peerBinding = binding ?? null;
    if (
      !this.#pendingConnection ||
      this.#pendingConnection.sessionId !== this.#localSessionId ||
      !this.#localSessionToken
    )
      return;
    if (
      this.#sessionBinding &&
      binding &&
      this.#sessionBinding.localFingerprint === binding.localFingerprint &&
      this.#sessionBinding.remoteFingerprint === binding.remoteFingerprint
    ) {
      this.#pendingConnection = null;
      this.#files.setPeerAuthenticated(peerId, true);
      return;
    }
    this.#dispatch(this.#closeLocalSession(false));
  };

  readonly #openIncomingSession = Effect.fn("TeamHostPeer.openIncomingSession")(function* (
    this: TeamWebRtcHostPeer,
    peerId: string,
    connection: Omit<IncomingConnection, "connectionId">,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    if (peerId !== this.#peerId) return;
    if (connection.sessionId === this.#localSessionId && this.#localSessionToken) return;
    // incoming already cleared the prior session; retain the active authentication gate.
    this.#events.clear();
    this.#responses.clear();
    this.#nextEventSequence = 1;
    const expiresAt = connection.sessionExpiresAt * 1_000;
    if (expiresAt <= Date.now()) return;
    const session = yield* remoteDecode(() => this.#store.openRemoteSession({ ...connection, expiresAt }));
    this.#localSessionToken = session.sessionToken;
    this.#localSessionId = connection.sessionId;
    this.#scheduleSessionExpiration(expiresAt);
  });

  #scheduleSessionExpiration(expiresAt: number): void {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      this.#dispatch(this.#closeLocalSession());
      return;
    }
    // Persistent sessions exceed Node's signed 32-bit timer range. Recheck in
    // bounded intervals instead of overflowing to an immediate disconnect.
    this.#sessionExpirationTimer = setTimeout(
      () => this.#scheduleSessionExpiration(expiresAt),
      Math.min(remaining, 2_147_483_647),
    );
    this.#sessionExpirationTimer.unref?.();
  }

  readonly #onData = (
    peerId: string,
    channel: "rpc" | "events" | "files" | "desktop",
    data: string | ArrayBuffer,
  ): void => {
    if (peerId !== this.#peerId) return;
    const authFrame = channel === "rpc" && isString(data) ? authenticationFrame(data) : null;
    if (authFrame?.type === "auth-init") {
      this.#dispatch(
        this.#handleAuthentication(peerId, authFrame).pipe(Effect.catchCause(() => this.#failProtocol(peerId))),
      );
      return;
    }
    if (authFrame?.type === "auth-complete") {
      this.#dispatch(
        this.#completeAuthentication(peerId, authFrame).pipe(Effect.catchCause(() => this.#failProtocol(peerId))),
      );
      return;
    }
    if (!this.#localSessionToken) {
      this.#dispatch(this.#failProtocol(peerId));
      return;
    }
    if (channel === "desktop") {
      this.#dispatch(
        this.#handleDesktopSignal(data).pipe(Effect.catchCause(() => Effect.sync(() => this.#closeDesktopSockets()))),
      );
      return;
    }
    if (!isString(data)) {
      if (channel === "rpc" || channel === "events") this.#dispatch(this.#failProtocol(peerId));
      return;
    }
    if (channel === "rpc")
      this.#dispatch(this.#handleRpc(data).pipe(Effect.catchCause(() => this.#failProtocol(peerId))));
    else if (channel === "events")
      this.#dispatch(this.#handleEventControl(data).pipe(Effect.catchCause(() => this.#failProtocol(peerId))));
  };

  readonly #onDisconnected = (peerId: string): void => {
    if (peerId === this.#peerId) {
      this.#files.setPeerAuthenticated(peerId, false);
      this.#sessionPreparation = null;
      this.#pendingConnection = null;
      this.#peerBinding = null;
      this.#peerCapabilities.clear();
      this.#authenticationCompletion = null;
      this.#dispatch(this.#closeLocalSession(false));
    }
  };

  readonly #handleAuthentication = Effect.fn("TeamHostPeer.handleAuthentication")(function* (
    this: TeamWebRtcHostPeer,
    peerId: string,
    frame: Extract<TeamProtocolV2AuthFrame, { type: "auth-init" }>,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    const pending = this.#pendingConnection;
    const binding = this.#peerBinding;
    const verifyClientTicket = this.#verifyClientTicket;
    if (!pending || !binding || !verifyClientTicket || this.#authenticationCompletion || this.#sessionPreparation) {
      return yield* new RemoteWorkflowError({ cause: new Error("Remote authentication is not ready.") });
    }
    const claims = yield* verifyClientTicket(frame.ticket);
    if (this.#peerId !== peerId || this.#pendingConnection !== pending || this.#peerBinding !== binding) {
      return yield* new RemoteWorkflowError({ cause: new Error("Remote authentication was cancelled.") });
    }
    if (
      claims.hostId !== this.#hostId ||
      claims.sessionId !== pending.sessionId ||
      claims.userId !== pending.userId ||
      claims.membershipId !== pending.membershipId ||
      claims.role !== pending.role ||
      claims.clientPublicKey !== frame.clientPublicKey ||
      claims.sessionExpiresAt !== pending.sessionExpiresAt
    ) {
      return yield* new RemoteWorkflowError({
        cause: new Error("The client ticket does not match the Signal connection."),
      });
    }
    const transcript = teamProtocolV2AuthenticationTranscript({
      hostId: this.#hostId,
      sessionId: claims.sessionId,
      ticket: frame.ticket,
      clientPublicKey: frame.clientPublicKey,
      clientNonce: frame.clientNonce,
      clientFingerprint: binding.remoteFingerprint,
      hostFingerprint: binding.localFingerprint,
    });
    if (
      !(yield* remoteDecode(() =>
        verify(null, Buffer.from(transcript), frame.clientPublicKey, Buffer.from(frame.signature, "base64url")),
      ))
    ) {
      return yield* new RemoteWorkflowError({ cause: new Error("The client proof of possession is invalid.") });
    }
    const hostNonce = randomBytes(32).toString("base64url");
    const responseTranscript = teamProtocolV2AuthenticationTranscript({
      hostId: this.#hostId,
      sessionId: claims.sessionId,
      ticket: frame.ticket,
      clientPublicKey: frame.clientPublicKey,
      clientNonce: frame.clientNonce,
      hostNonce,
      clientFingerprint: binding.remoteFingerprint,
      hostFingerprint: binding.localFingerprint,
    });
    this.#authenticationCompletion = { claims, clientNonce: frame.clientNonce, hostNonce };
    yield* HostPeerTransport.use((transport) =>
      transport.send(
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "auth-ready",
          clientNonce: frame.clientNonce,
          hostNonce,
          signature: this.#store.signRemoteAuthentication(responseTranscript),
        }),
      ),
    );
  });

  readonly #completeAuthentication = Effect.fn("TeamHostPeer.completeAuthentication")(function* (
    this: TeamWebRtcHostPeer,
    peerId: string,
    frame: Extract<TeamProtocolV2AuthFrame, { type: "auth-complete" }>,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    const completion = this.#authenticationCompletion;
    if (
      !completion ||
      frame.clientNonce !== completion.clientNonce ||
      frame.hostNonce !== completion.hostNonce ||
      this.#sessionPreparation
    ) {
      return yield* new RemoteWorkflowError({ cause: new Error("The authentication completion is invalid.") });
    }
    this.#authenticationCompletion = null;
    const preparation = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#sessionPreparation = preparation;
    yield* this.#openIncomingSession(peerId, completion.claims).pipe(
      Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(preparation, exit))),
    );
    this.#sessionPreparation = null;
    if (!this.#localSessionToken)
      return yield* new RemoteWorkflowError({ cause: new Error("The remote session did not open.") });
    if (!this.#peerBinding)
      return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC fingerprint binding is unavailable.") });
    this.#sessionBinding = { ...this.#peerBinding };
    this.#files.setPeerAuthenticated(peerId, true);
    yield* HostPeerTransport.use((transport) =>
      transport.send(
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "auth-confirmed",
          clientNonce: frame.clientNonce,
          hostNonce: frame.hostNonce,
        }),
      ),
    );
    this.#pendingConnection = null;
  });

  readonly #handleRpc = Effect.fn("TeamHostPeer.handleRpc")(function* (
    this: TeamWebRtcHostPeer,
    data: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    if (this.#sessionPreparation) yield* Deferred.await(this.#sessionPreparation);
    const peerId = this.#peerId;
    if (!peerId) return;
    const request = yield* remoteDecode(() => {
      try {
        const decoded = decodeTeamProtocolV2RpcFrame(data);
        if (decoded.type !== "request") throw new Error("The RPC frame is not a request.");
        return decoded;
      } catch (cause) {
        throw new Error("The client sent an invalid RPC frame.", { cause });
      }
    });
    const cached = this.#responses.get(request.requestId);
    if (cached) {
      yield* HostPeerTransport.use((transport) => transport.send(peerId, "rpc", encodeTeamProtocolV2Frame(cached)));
      return;
    }
    const sessionId = this.#localSessionId;
    const inFlightKey = `${sessionId}\0${request.requestId}`;
    let responseOperation = this.#responsesInFlight.get(inFlightKey);
    if (!responseOperation) {
      responseOperation = yield* Effect.forkIn(
        this.#createRpcResponse(request).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              if (this.#localSessionId === sessionId) {
                this.#responses.set(request.requestId, response);
                while (this.#responses.size > 1_000) deleteOldest(this.#responses);
              }
            }),
          ),
        ),
        this.#runtime.scope,
        { startImmediately: false },
      );
      this.#responsesInFlight.set(inFlightKey, responseOperation);
      const pending = responseOperation;
      pending.addObserver(() => {
        if (this.#responsesInFlight.get(inFlightKey) === pending) this.#responsesInFlight.delete(inFlightKey);
      });
    }
    const response = yield* Fiber.join(responseOperation);
    if (this.#peerId !== peerId || this.#localSessionId !== sessionId) return;
    yield* HostPeerTransport.use((transport) => transport.send(peerId, "rpc", encodeTeamProtocolV2Frame(response)));
  });

  readonly #createRpcResponse = Effect.fn("TeamHostPeer.createRpcResponse")(function* (
    this: TeamWebRtcHostPeer,
    request: Extract<TeamProtocolV2RpcFrame, { type: "request" }>,
  ): Effect.fn.Return<TeamProtocolV2RpcFrame, RemoteWorkflowError, HostPeerTransport> {
    return yield* Effect.gen({ self: this }, function* () {
      if (request.operation !== "http.request" || !isHttpRequest(request.payload)) {
        return yield* new RemoteWorkflowError({
          cause: new GatewayError(400, "unsupported_operation", "The Team API operation is not supported."),
        });
      }
      const result = yield* this.#dispatchHttpEffect(request.payload);
      return yield* remoteDecode(() =>
        decodeTeamProtocolV2RpcFrame({ version: 2, type: "response", requestId: request.requestId, result }),
      );
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          const status = error instanceof GatewayError ? error.status : 500;
          return yield* remoteDecode(() =>
            decodeTeamProtocolV2RpcFrame({
              version: 2,
              type: "response",
              requestId: request.requestId,
              error: {
                code: error instanceof GatewayError ? error.code : "host_error",
                message: error instanceof Error ? error.message : sourceText("error.remote.hostRequestFailed"),
                retryable: status >= 500,
                status,
              },
            }),
          );
        }),
      ),
    );
  });

  readonly #dispatchHttpEffect = Effect.fn("TeamHostPeer.dispatchHttp")(function* (
    this: TeamWebRtcHostPeer,
    input: HttpRequestPayload,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    if (!this.#localApiPort || !this.#localSessionToken)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(401, "remote_session_missing", sourceText("error.remote.sessionNotReady")),
      });
    const url = yield* remoteDecode(() => new URL(input.path, `http://127.0.0.1:${this.#localApiPort}`));
    if (url.origin !== `http://127.0.0.1:${this.#localApiPort}` || !url.pathname.startsWith("/v1/")) {
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(400, "invalid_operation_path", "The Team API path is invalid."),
      });
    }
    const peerId = this.#peerId;
    if (!peerId)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(503, "remote_disconnected", sourceText("error.remote.peerDisconnected")),
      });
    const peerCapabilities = new Set(input.capabilities ?? []);
    const capabilitiesChanged =
      peerCapabilities.size !== this.#peerCapabilities.size ||
      [...peerCapabilities].some((capability) => !this.#peerCapabilities.has(capability));
    this.#peerCapabilities = peerCapabilities;
    if (capabilitiesChanged) this.#sendAgentEventScope();
    const request = { url, peerId, peerCapabilities, preserveSemanticTags: supportsTeamSemanticTags(peerCapabilities) };
    // An uploaded body stays on disk: the request reads it from the file, and the file is removed
    // after the response is complete.
    if (input.bodyTransferId) {
      return yield* this.#files.useReceived(peerId, input.bodyTransferId, (uploaded) =>
        this.#forwardHttpEffect(input, request, uploaded),
      );
    }
    return yield* this.#forwardHttpEffect(input, request, null);
  });

  readonly #forwardHttpEffect = Effect.fn("TeamHostPeer.forwardHttp")(function* (
    this: TeamWebRtcHostPeer,
    input: HttpRequestPayload,
    {
      url,
      peerId,
      peerCapabilities,
      preserveSemanticTags,
    }: { url: URL; peerId: string; peerCapabilities: Set<string>; preserveSemanticTags: boolean },
    uploaded: ReceivedWebRtcFile | null,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    const sideRoute = teamSideRouteCodec(input.path);
    const requestBody =
      input.method === "GET"
        ? undefined
        : uploaded
          ? yield* remoteCall(() => openAsBlob(uploaded.path))
          : input.body === null
            ? undefined
            : yield* remoteDecode(() =>
                JSON.stringify(
                  sideRoute
                    ? sideRoute.request(input.path, input.body)
                    : (peerCapabilities.has(TEAM_PI_MUSE_CAPABILITY)
                        ? decodeTeamProtocolV7WebRtcHttpRequest
                        : peerCapabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)
                          ? decodeTeamProtocolV6WebRtcHttpRequest
                          : peerCapabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)
                            ? decodeTeamProtocolV5WebRtcHttpRequest
                            : peerCapabilities.has("opencode")
                              ? decodeTeamProtocolV4WebRtcHttpRequest
                              : decodeTeamProtocolV3WebRtcHttpRequest)(input.method, input.path, input.body, {
                        preserveSemanticTags,
                        agentCreateModel: peerCapabilities.has(TEAM_AGENT_CREATE_MODEL_CAPABILITY),
                      }),
                ),
              );
    return yield* Effect.acquireUseRelease(
      HostPeerTransport.use((transport) =>
        transport.fetch(url, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${this.#localSessionToken}`,
            "Content-Type": uploaded?.mimeType ?? input.contentType ?? "application/json",
            "OpenBot-Protocol-Version": peerCapabilities.has(TEAM_PI_MUSE_CAPABILITY)
              ? "7"
              : peerCapabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)
                ? "6"
                : peerCapabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)
                  ? "5"
                  : peerCapabilities.has("opencode")
                    ? "4"
                    : isTeamProtocolV3OnlyRoute(input.method, input.path)
                      ? "3"
                      : "1",
            "OpenBot-App-Version": this.#appVersion,
            "OpenBot-Capabilities": [...this.#peerCapabilities].join(","),
            ...(this.#localSessionId ? { "X-OpenBot-WebRTC-Session": this.#localSessionId } : {}),
          },
          body: requestBody,
        }),
      ),
      (response) =>
        Effect.gen({ self: this }, function* () {
          const contentType = response.headers.get("content-type") ?? "";
          const isFile = response.headers.get("content-disposition")?.startsWith("attachment;") ?? false;
          const body =
            response.status === 204
              ? {}
              : contentType.includes("json") && !isFile
                ? yield* remoteCall(() => response.json())
                : null;
          if (!response.ok) {
            const record = isDynamicRecord(body) ? body : null;
            return yield* new RemoteWorkflowError({
              cause: new GatewayError(
                response.status,
                isString(record?.code) ? record.code : "team_api_error",
                isString(record?.error) ? record.error : `The host returned ${response.status}.`,
              ),
            });
          }
          if (response.status !== 204 && (isFile || !contentType.includes("json"))) {
            const name = contentDispositionFileName(response.headers.get("content-disposition"), "remote-file");
            // The body goes to disk in chunks and not to one buffer, so a 100 MB download does not stay in
            // main for the minutes that the data channel needs to send it.
            const { transferId, size } = yield* this.#files.sendStream(peerId, {
              name,
              mimeType: contentType || "application/octet-stream",
              body: response.body ?? [],
            });
            return {
              status: response.status,
              body: null,
              file: { transferId, name, mimeType: contentType || "application/octet-stream", size },
            };
          }
          return yield* remoteDecode(() => ({
            status: response.status,
            body: sideRoute
              ? sideRoute.response(input.path, response.status, body)
              : (peerCapabilities.has(TEAM_PI_MUSE_CAPABILITY)
                  ? encodeTeamProtocolV7WebRtcHttpResponse
                  : peerCapabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)
                    ? encodeTeamProtocolV6WebRtcHttpResponse
                    : peerCapabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)
                      ? encodeTeamProtocolV5WebRtcHttpResponse
                      : peerCapabilities.has("opencode")
                        ? encodeTeamProtocolV4WebRtcHttpResponse
                        : encodeTeamProtocolV3WebRtcHttpResponse)(input.method, input.path, response.status, body, {
                  preserveSemanticTags,
                }),
          }));
        }),
      (response) =>
        remoteCall(() => (response.body ? response.body.cancel() : Promise.resolve())).pipe(
          Effect.catch(() => Effect.void),
        ),
    );
  });

  #connectLocalEvents(token: string): void {
    if (!this.#localApiPort) return;
    this.#eventsSocket?.close();
    const socket = new webSockets.WebSocket(`ws://127.0.0.1:${this.#localApiPort}${TEAM_API_ROUTES.events}`, [
      "openbot-team-v1",
      `openbot-token.${token}`,
    ]);
    this.#eventsSocket = socket;
    socket.once("open", () => {
      this.#eventsReconnectAttempts = 0;
      this.#sendAgentEventScope();
    });
    socket.on("message", (data, binary) => {
      if (binary || !this.#peerId) return;
      let frame: string;
      try {
        // `channels-changed` is outside the frozen v1 vocabulary, so the base event adapter
        // rejects it and the catch below would drop it without a trace: a remote client would
        // stop seeing incoming messages and task updates until its next refresh. The optional
        // protocol validates and envelopes its own event, exactly as the request path does. The
        // `host-update-v1`, `skills-events-v1`, and `quiet-turn-v1` events take the same path.
        const event = JSON.parse(data.toString());
        const channel = optionalTeamEvent(event);
        frame = encodeTeamProtocolV2Frame(
          channel
            ? decodeTeamProtocolV2EventFrame({
                version: 2,
                type: "event",
                sequence: this.#nextEventSequence,
                payload: channel,
              })
            : (this.#peerCapabilities.has(TEAM_PI_MUSE_CAPABILITY)
                ? createTeamProtocolV7Event
                : this.#peerCapabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)
                  ? createTeamProtocolV6Event
                  : this.#peerCapabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)
                    ? createTeamProtocolV5Event
                    : this.#peerCapabilities.has("opencode")
                      ? createTeamProtocolV4Event
                      : createTeamProtocolV2Event)(this.#nextEventSequence, event, {
                preserveSemanticTags: supportsTeamSemanticTags(this.#peerCapabilities),
                preserveBrowserSecrets: this.#peerCapabilities.has("browser-secret-handoff"),
              }),
        );
      } catch {
        return;
      }
      const sequence = this.#nextEventSequence++;
      if (this.#events.size >= MAXIMUM_BUFFERED_EVENTS) {
        this.#events.clear();
        this.#sendRecoverable(
          this.#peerId,
          "events",
          encodeTeamProtocolV2Frame({ version: 2, type: "event-reset", nextSequence: sequence }),
        );
      }
      this.#events.set(sequence, frame);
      this.#sendRecoverable(this.#peerId, "events", frame);
    });
    socket.once("error", () => socket.close());
    socket.once("close", () => {
      if (this.#eventsSocket !== socket) return;
      this.#eventsSocket = null;
      this.#scheduleLocalEventsReconnect();
    });
  }

  #sendAgentEventScope(): void {
    if (this.#eventsSocket?.readyState !== webSockets.WebSocket.OPEN) return;
    this.#eventsSocket.send(
      encodeTeamProtocolV1ClientEvent({
        type: "agent-event-scope",
        includeConversations: true,
        capabilities: TEAM_CURRENT_CAPABILITIES.filter((capability) => this.#peerCapabilities.has(capability)),
      }),
    );
  }

  #scheduleLocalEventsReconnect(): void {
    if (this.#eventsReconnectTimer || !this.#localSessionToken || !this.#localSessionId || !this.#peerId) return;
    const delay = Math.min(10_000, 250 * 2 ** this.#eventsReconnectAttempts++);
    this.#eventsReconnectTimer = setTimeout(() => {
      this.#eventsReconnectTimer = null;
      const token = this.#localSessionToken;
      if (token) this.#connectLocalEvents(token);
    }, delay);
  }

  readonly #handleEventControl = Effect.fn("TeamHostPeer.handleEventControl")(function* (
    this: TeamWebRtcHostPeer,
    data: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    if (this.#sessionPreparation) yield* Deferred.await(this.#sessionPreparation);
    const frame = yield* remoteDecode(() => decodeTeamProtocolV2EventFrame(data));
    if (!this.#eventsSocket && this.#localSessionToken) this.#connectLocalEvents(this.#localSessionToken);
    if (frame.type === "event-control") {
      if (this.#eventsSocket?.readyState === webSockets.WebSocket.OPEN) {
        this.#eventsSocket.send(encodeTeamProtocolV1ClientEvent(frame.control));
      }
      return;
    }
    if (frame.type !== "event-ack")
      return yield* new RemoteWorkflowError({ cause: new Error("The event frame is not client control data.") });
    for (const sequence of this.#events.keys()) if (sequence <= frame.throughSequence) this.#events.delete(sequence);
    const peerId = this.#peerId;
    if (!peerId) return;
    const bufferedEvents = [...this.#events].sort(([left], [right]) => left - right);
    const firstSequence = bufferedEvents[0]?.[0];
    if (firstSequence !== undefined && frame.throughSequence < firstSequence - 1) {
      yield* HostPeerTransport.use((transport) =>
        transport.send(
          peerId,
          "events",
          encodeTeamProtocolV2Frame({ version: 2, type: "event-reset", nextSequence: firstSequence }),
        ),
      );
    }
  });

  readonly #failProtocol = Effect.fn("TeamHostPeer.failProtocol")(function* (this: TeamWebRtcHostPeer, peerId: string) {
    if (peerId !== this.#peerId) return;
    this.#files.setPeerAuthenticated(peerId, false);
    yield* this.#closeLocalSession();
    yield* this.#bridge.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
  });

  readonly #handleDesktopSignal = Effect.fn("TeamHostPeer.handleDesktopSignal")(function* (
    this: TeamWebRtcHostPeer,
    data: string | ArrayBuffer,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    if (this.#sessionPreparation) yield* Deferred.await(this.#sessionPreparation);
    const peerId = this.#peerId;
    if (!peerId || !this.#localApiPort || !this.#localSessionId) return;
    if (!isString(data)) {
      const frame = yield* remoteDecode(() => decodeRemoteDesktopSignalBinary(data));
      const socket = this.#desktopSockets.get(frame.streamId);
      if (socket?.readyState !== webSockets.WebSocket.OPEN) return;
      socket.send(frame.bytes, { binary: true });
      return;
    }
    const control = yield* remoteDecode(() => decodeRemoteDesktopSignalControl(data));
    if (control.type === "open") {
      yield* this.#openDesktopSocket(peerId, control.streamId, control.path);
      return;
    }
    const socket = this.#desktopSockets.get(control.streamId);
    if (!socket) return;
    if (control.type === "text" && socket.readyState === webSockets.WebSocket.OPEN) {
      socket.send(control.data);
    } else if (control.type === "close") {
      socket.close(sendableCloseCode(control.code), control.reason);
    }
  });

  /**
   * The tunnel carries more than one stream at a time: a member can watch a browser tab while a
   * Moonlight session runs. Each stream keeps its own socket, and only the paths named here are
   * reachable -- the tunnel opens sockets on the host's own port, so its allowlist is the boundary.
   */
  readonly #openDesktopSocket = Effect.fn("TeamHostPeer.openDesktopSocket")(function* (
    this: TeamWebRtcHostPeer,
    peerId: string,
    streamId: string,
    path: string,
  ) {
    const url = yield* remoteDecode(() => new URL(path, `ws://127.0.0.1:${this.#localApiPort}`));
    const allowed =
      url.origin === `ws://127.0.0.1:${this.#localApiPort}` &&
      (/^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/stream$/u.test(url.pathname) ||
        browserViewStreamSessionId(url.pathname) !== null);
    if (!allowed || this.#desktopSockets.size >= MAXIMUM_DESKTOP_STREAMS) {
      yield* HostPeerTransport.use((transport) =>
        transport.send(
          peerId,
          "desktop",
          encodeRemoteDesktopSignalControl({
            type: "error",
            streamId,
            message: allowed ? sourceText("error.remote.tooManyStreams") : "The remote desktop signal path is invalid.",
          }),
        ),
      ).pipe(Effect.catch(() => Effect.void));
      return;
    }
    this.#closeDesktopSocket(streamId);
    const sessionId = this.#localSessionId ?? "";
    const socket = yield* remoteDecode(
      () => new webSockets.WebSocket(url, { headers: { "X-OpenBot-WebRTC-Session": sessionId } }),
    );
    this.#desktopSockets.set(streamId, socket);
    socket.once("open", () => {
      this.#sendRecoverable(peerId, "desktop", encodeRemoteDesktopSignalControl({ type: "opened", streamId }));
    });
    socket.on("message", (message, binary) => {
      if (this.#desktopSockets.get(streamId) !== socket) return;
      if (binary) {
        this.#sendRecoverable(peerId, "desktop", encodeRemoteDesktopSignalBinary(streamId, rawDataBytes(message)));
      } else {
        this.#sendRecoverable(
          peerId,
          "desktop",
          encodeRemoteDesktopSignalControl({ type: "text", streamId, data: message.toString() }),
        );
      }
    });
    socket.once("close", (code, reason) => {
      if (this.#desktopSockets.get(streamId) !== socket) return;
      this.#desktopSockets.delete(streamId);
      this.#sendRecoverable(
        peerId,
        "desktop",
        encodeRemoteDesktopSignalControl({ type: "close", streamId, code, reason: reason.toString() }),
      );
    });
    socket.once("error", () => {
      this.#sendRecoverable(
        peerId,
        "desktop",
        encodeRemoteDesktopSignalControl({
          type: "error",
          streamId,
          message: sourceText("error.remote.streamSocketFailed"),
        }),
      );
    });
  });

  readonly #closeLocalSession = Effect.fn("TeamHostPeer.closeLocalSession")(function* (
    this: TeamWebRtcHostPeer,
    endLogicalSession = true,
  ) {
    const closingSessionId = this.#localSessionId;
    if (this.#peerId) this.#files.setPeerAuthenticated(this.#peerId, false);
    if (this.#sessionExpirationTimer) clearTimeout(this.#sessionExpirationTimer);
    this.#sessionExpirationTimer = null;
    this.#closeDesktopSockets();
    if (this.#eventsReconnectTimer) clearTimeout(this.#eventsReconnectTimer);
    this.#eventsReconnectTimer = null;
    this.#eventsReconnectAttempts = 0;
    this.#eventsSocket?.close();
    this.#eventsSocket = null;
    if (this.#localSessionId) {
      this.#store.closeRemoteSession(this.#localSessionId);
    }
    this.#localSessionId = null;
    this.#localSessionToken = null;
    this.#sessionBinding = null;
    this.#sessionPreparation = null;
    this.#authenticationCompletion = null;
    if (endLogicalSession && closingSessionId) {
      // Invalidate local access immediately. Remote logout must not delay the next handshake.
      const closing = yield* Effect.forkIn(
        this.#closeSession(closingSessionId).pipe(Effect.catch(() => Effect.void)),
        this.#runtime.scope,
        { startImmediately: false },
      );
      this.#closingSessions.add(closing);
      closing.addObserver(() => this.#closingSessions.delete(closing));
    }
  });

  #sendRecoverable(peerId: string, channel: "events" | "desktop", data: string | ArrayBuffer): void {
    if (peerId !== this.#peerId) return;
    this.#dispatch(
      HostPeerTransport.use((transport) => transport.send(peerId, channel, data)).pipe(Effect.catch(() => Effect.void)),
    );
  }

  #closeDesktopSocket(streamId: string): void {
    const socket = this.#desktopSockets.get(streamId);
    this.#desktopSockets.delete(streamId);
    socket?.close(1000, "Remote desktop signal stopped");
  }

  #closeDesktopSockets(): void {
    for (const streamId of [...this.#desktopSockets.keys()]) this.#closeDesktopSocket(streamId);
  }
}

interface HttpRequestPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: TeamProtocolV2Json;
  bodyTransferId?: string;
  contentType?: string;
  capabilities?: string[];
}

function isHttpRequest(value: TeamProtocolV2Json): value is TeamProtocolV2Json & HttpRequestPayload {
  if (!isDynamicRecord(value)) return false;
  const method = value.method;
  return (
    (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") &&
    isString(value.path) &&
    value.path.length <= 2_048 &&
    Object.hasOwn(value, "body") &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) &&
        value.capabilities.length <= (value.capabilities.includes(TEAM_PI_MUSE_CAPABILITY) ? 128 : 64) &&
        value.capabilities.every(isString))) &&
    (value.bodyTransferId === undefined || isString(value.bodyTransferId)) &&
    (value.contentType === undefined || isString(value.contentType))
  );
}

function deleteOldest<Key, Value>(values: Map<Key, Value>): void {
  const oldest = values.keys().next();
  if (!oldest.done) values.delete(oldest.value);
}

function authenticationFrame(data: string): TeamProtocolV2AuthFrame | null {
  try {
    return decodeTeamProtocolV2AuthFrame(data);
  } catch {
    return null;
  }
}

class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
