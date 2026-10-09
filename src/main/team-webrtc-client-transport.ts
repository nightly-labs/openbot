import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  type TeamProtocolV1CurrentEventControl,
  toWireTeamProtocolV1ClientEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
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
import {
  decodeTeamProtocolV6CurrentEvent,
  decodeTeamProtocolV6WebRtcHttpResponse,
  encodeTeamProtocolV6WebRtcHttpRequest,
} from "@openbot/contracts/team-protocol/v6-webrtc-adapter";
import { sourceText } from "@openbot/i18n/source";
import { remoteWorkspaceReadTimeout } from "@openbot/team-client/remote-recovery";
import { Context, Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { RemoteConnectionBootstrap } from "./central-auth-manager";
import type {
  RemoteHostSummary,
  RemoteInvitePreview,
  RemoteInviteRecord,
  RemoteMemberRecord,
} from "./central-auth-records";
import type { RemoteConnectTrace } from "./remote-connect-trace";
import { RemoteWorkflowError, remoteDecode, toRemoteWorkflowError } from "./remote-service-effects";
import type { RemoteSessionCache } from "./remote-session-cache";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcFileTransfer } from "./team-webrtc-file-transfer";

export const TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS = 10 * 60_000 + 30_000;

/** Node clamps a longer `setTimeout` to one millisecond, and says so on stderr. */
const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

interface TeamWebRtcClientTransportEvents {
  connected: [hostId: string];
  disconnected: [hostId: string];
  event: [hostId: string, event: AgentEvent | TeamRealtimeEvent];
  path: [hostId: string, path: "p2p" | "relay"];
  error: [hostId: string, code: string, message: string];
  desktopData: [hostId: string, data: string | ArrayBuffer];
}

interface TeamWebRtcClientTransportOptions {
  bridge: TeamWebRtcBridge;
  listHosts: () => Effect.Effect<RemoteHostSummary[], CentralAuthOperationError>;
  startSession: (
    hostId: string,
  ) => Effect.Effect<{ sessionId: string; hostId: string; expiresAt: number }, CentralAuthOperationError>;
  issueTicket: (
    sessionId: string,
    clientPublicKey: string,
  ) => Effect.Effect<RemoteConnectionBootstrap, CentralAuthOperationError>;
  endSession: (sessionId: string) => Effect.Effect<void, CentralAuthOperationError>;
  createInvite: (
    hostId: string,
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ) => Effect.Effect<
    { inviteId: string; token: string; expiresAt: number; permanent: boolean; useCount: number },
    CentralAuthOperationError
  >;
  listInvites: (hostId: string) => Effect.Effect<RemoteInviteRecord[], CentralAuthOperationError>;
  previewInvite: (token: string) => Effect.Effect<RemoteInvitePreview, CentralAuthOperationError>;
  acceptInvite: (
    token: string,
  ) => Effect.Effect<{ hostId: string; membershipId: string; role: "admin" | "member" }, CentralAuthOperationError>;
  revokeInvite: (inviteId: string) => Effect.Effect<void, CentralAuthOperationError>;
  listMembers: (hostId: string) => Effect.Effect<RemoteMemberRecord[], CentralAuthOperationError>;
  updateMember: (
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate?: boolean,
  ) => Effect.Effect<void, CentralAuthOperationError>;
  removeMember: (hostId: string, membershipId: string) => Effect.Effect<void, CentralAuthOperationError>;
  getPrincipalId: () => string;
  controlPlaneUrl: string;
  downloadHostLogo: (
    hostId: string,
    version: string,
  ) => Effect.Effect<{ bytes: Uint8Array; mimeType: string }, CentralAuthOperationError>;
  transferDirectory: string;
  /** Times each connection for the local trace. */
  connectTrace?: RemoteConnectTrace;
  /**
   * Keeps each host's session between runs. With it, the next start asks only for a ticket, and
   * `stop` leaves the sessions open for that start instead of ending them.
   */
  sessionCache?: RemoteSessionCache;
}

interface ActiveHost {
  sessionId: string;
  expiresAt: number;
  principalId: string;
  connected: boolean;
  connecting: Deferred.Deferred<void, RemoteWorkflowError> | null;
  cancelled: boolean;
  /** Closed by `stop` with its session kept for the next run, so nothing may end that session. */
  released: boolean;
  cancelConnectionWait: (() => void) | null;
  expirationTimer: ReturnType<typeof setTimeout> | null;
  authentication: {
    ticket: string;
    clientPublicKey: string;
    clientPrivateKey: string;
    clientNonce: string;
    hostPublicKey: string;
    binding: { localFingerprint: string; remoteFingerprint: string } | null;
    started: boolean;
    completed: boolean;
    hostNonce: string | null;
  } | null;
}

/**
 * A session kept after a connect attempt failed. The control plane keeps a session until the client
 * ends it, so the next attempt only needs a ticket for it.
 */
interface RetainedSession {
  sessionId: string;
  expiresAt: number;
  principalId: string;
  connected: false;
  connecting: null;
}

class TeamClientBridge extends Context.Service<
  TeamClientBridge,
  {
    start(): Effect.Effect<void, RemoteWorkflowError>;
    prepareSignal(peerId: string, signalUrl: string): Effect.Effect<void, RemoteWorkflowError>;
    send(...args: Parameters<TeamWebRtcBridge["send"]>): Effect.Effect<void, RemoteWorkflowError>;
    connect(...args: Parameters<TeamWebRtcBridge["connect"]>): Effect.Effect<void, RemoteWorkflowError>;
    disconnect(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
  }
>()("openbot/main/TeamClientBridge") {}

export class TeamWebRtcClientTransport extends EventEmitter<TeamWebRtcClientTransportEvents> {
  readonly #options: TeamWebRtcClientTransportOptions;
  readonly #platform: Layer.Layer<TeamClientBridge>;
  #stopped = false;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #active = new Map<string, ActiveHost>();
  // A failed attempt used to end its session, so each retry against an offline host was a create, a
  // ticket and an end: three Worker requests and a Signal webhook. Only `disconnect` ends it now.
  readonly #retainedSessions = new Map<string, RetainedSession>();
  readonly #files: TeamWebRtcFileTransfer;
  readonly #pending = new Map<
    string,
    {
      hostId: string;
      resolve: (value: TeamProtocolV2Json) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #lastEventSequence = new Map<string, number>();
  readonly #hostPublicKeys = new Map<string, string>();
  /** Set while the account directory is read at startup. A host without a pinned key waits for it. */
  #hostKeySync: Deferred.Deferred<void> | null = null;
  /** The Signal address of the last ticket of this run. */
  #signalUrl: string | null = null;

  constructor(options: TeamWebRtcClientTransportOptions) {
    super();
    this.#options = options;
    this.#platform = Layer.succeed(
      TeamClientBridge,
      TeamClientBridge.of({
        start: () => options.bridge.start(),
        prepareSignal: (peerId, signalUrl) => options.bridge.prepareSignal(peerId, signalUrl),
        send: (...args) => options.bridge.send(...args),
        connect: (...args) => options.bridge.connect(...args),
        disconnect: (hostId) => options.bridge.disconnect(hostId),
      }),
    );
    this.#files = new TeamWebRtcFileTransfer(
      options.bridge,
      options.transferDirectory,
      undefined,
      (peerId) => this.#active.get(peerId)?.connected === true,
    );
    options.bridge.on("connected", this.#onConnected);
    options.bridge.on("disconnected", this.#onDisconnected);
    options.bridge.on("data", this.#onData);
    options.bridge.on("path", this.#onPath);
    options.bridge.on("error", this.#onError);
    options.bridge.on("signalReady", this.#onSignalReady);
    options.bridge.on("signalOpen", this.#onSignalOpen);
  }

  readonly listHosts = Effect.fn("TeamWebRtcClient.listHosts")(function* (
    this: TeamWebRtcClientTransport,
  ): Effect.fn.Return<RemoteHostSummary[], RemoteWorkflowError> {
    return yield* this.#owned(this.#options.listHosts().pipe(toRemoteWorkflowError));
  }).bind(this);

  pinHostKey(hostId: string, publicKey: string): void {
    this.#hostPublicKeys.set(hostId, publicKey);
  }

  /**
   * The keys of the account directory are not known yet. Until `endHostKeySync`, a connect to a host
   * without a pinned key waits instead of failing. A host with a pinned key does not wait: the
   * directory never replaces a pinned key.
   */
  beginHostKeySync(): void {
    this.#hostKeySync ??= Deferred.makeUnsafe<void>();
  }

  endHostKeySync(): void {
    const pending = this.#hostKeySync;
    this.#hostKeySync = null;
    if (pending) Deferred.doneUnsafe(pending, Effect.void);
  }

  get controlPlaneUrl(): string {
    return this.#options.controlPlaneUrl;
  }

  downloadHostLogo(hostId: string, version: string) {
    return this.#owned(this.#options.downloadHostLogo(hostId, version).pipe(toRemoteWorkflowError));
  }

  createInvite(hostId: string, input: { role: "admin" | "member"; email?: string }) {
    return this.#owned(this.#options.createInvite(hostId, input).pipe(toRemoteWorkflowError));
  }

  listInvites(hostId: string) {
    return this.#owned(this.#options.listInvites(hostId).pipe(toRemoteWorkflowError));
  }

  previewInvite(token: string) {
    return this.#owned(this.#options.previewInvite(token).pipe(toRemoteWorkflowError));
  }

  acceptInvite(token: string) {
    return this.#owned(this.#options.acceptInvite(token).pipe(toRemoteWorkflowError));
  }

  revokeInvite(inviteId: string) {
    return this.#owned(this.#options.revokeInvite(inviteId).pipe(toRemoteWorkflowError));
  }

  listMembers(hostId: string) {
    return this.#owned(this.#options.listMembers(hostId).pipe(toRemoteWorkflowError));
  }

  updateMember(hostId: string, membershipId: string, role: "admin" | "member", reactivate = false) {
    return this.#owned(this.#options.updateMember(hostId, membershipId, role, reactivate).pipe(toRemoteWorkflowError));
  }

  removeMember(hostId: string, membershipId: string) {
    return this.#owned(this.#options.removeMember(hostId, membershipId).pipe(toRemoteWorkflowError));
  }

  readonly leaveHost = Effect.fn("TeamWebRtcClient.leaveHost")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const host = (yield* this.#options.listHosts().pipe(toRemoteWorkflowError)).find(
          (candidate) => candidate.hostId === hostId,
        );
        if (!host) return;
        if (host.role === "owner")
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.ownerCannotLeave")) });
        yield* this.#options.removeMember(hostId, host.membershipId).pipe(toRemoteWorkflowError);
      }),
    );
  }).bind(this);

  readonly sendDesktop = Effect.fn("TeamWebRtcClient.sendDesktop")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    data: string | ArrayBuffer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        yield* this.#ensureConnected(hostId);
        yield* TeamClientBridge.use((bridge) => bridge.send(hostId, "desktop", data));
      }),
    );
  }).bind(this);

  readonly requestRuntimeSnapshot = Effect.fn("TeamWebRtcClient.requestRuntimeSnapshot")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(this.#sendEventControlEffect(hostId, { type: "runtime-snapshot-request" }));
  }).bind(this);

  readonly setTyping = Effect.fn("TeamWebRtcClient.setTyping")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    agentId: string | null,
    typing: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(this.#sendEventControlEffect(hostId, { type: "team-typing", agentId, typing }));
  }).bind(this);

  readonly setDirectTyping = Effect.fn("TeamWebRtcClient.setDirectTyping")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    recipientMemberId: string,
    typing: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(
      this.#sendEventControlEffect(hostId, { type: "team-direct-typing", recipientMemberId, typing }),
    );
  }).bind(this);

  connect(hostId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.#owned(this.#ensureConnected(hostId));
  }

  /**
   * Whether the data channel to this host is up and authenticated. `connect` resolves either way,
   * and only the first of the two announces itself with a `connected` event, so a caller that has
   * to reconcile its own state with the transport's needs to be able to ask.
   */
  isConnected(hostId: string): boolean {
    return this.#active.get(hostId)?.connected === true;
  }

  readonly request = Effect.fn("TeamWebRtcClient.request")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      preserveSemanticTags?: boolean;
      agentCreateModel?: boolean;
      timeoutMs?: number;
    } = {},
  ): Effect.fn.Return<TeamProtocolV2Json | undefined, RemoteWorkflowError> {
    return yield* this.#owned(
      this.requestResponse(hostId, path, init).pipe(
        Effect.map((response) => (response.status === 204 ? undefined : response.body)),
      ),
    );
  }).bind(this);

  readonly requestResponse = Effect.fn("TeamWebRtcClient.requestResponse")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      contentType?: string;
      preserveSemanticTags?: boolean;
      agentCreateModel?: boolean;
      timeoutMs?: number;
    } = {},
  ): Effect.fn.Return<
    {
      status: number;
      body: TeamProtocolV2Json;
      file?: { bytes: Uint8Array; name: string; mimeType: string };
    },
    RemoteWorkflowError
  > {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        yield* this.#ensureConnected(hostId);
        const method = (init.method ?? "GET").toUpperCase();
        const binary = binaryBody(init.body);
        const sideRoute = teamSideRouteCodec(path);
        const bodyTransferId = binary
          ? yield* this.#files.send(hostId, {
              name: "upload",
              mimeType: init.contentType ?? "application/octet-stream",
              bytes: binary,
            })
          : null;
        const requestId = crypto.randomUUID();
        const frame = yield* remoteDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "request",
            requestId,
            operation: "http.request",
            payload: {
              method,
              path,
              body: binary
                ? null
                : sideRoute
                  ? sideRoute.request(path, init.body)
                  : encodeTeamProtocolV6WebRtcHttpRequest(method, path, init.body, {
                      preserveSemanticTags: init.preserveSemanticTags,
                      agentCreateModel: init.agentCreateModel,
                    }),
              capabilities: [...TEAM_CURRENT_CAPABILITIES],
              ...(bodyTransferId ? { bodyTransferId } : {}),
              ...(init.contentType ? { contentType: init.contentType } : {}),
            },
          }),
        );
        // A closed channel refuses the frame before any byte leaves, so the host did not get the
        // request. After the computer sleeps, main can read the host as connected on a connection
        // that the host closed. Connect again and send the same frame once. An upload stays on the
        // connection that carried its body. Only the connection that refused the frame is marked
        // lost: a request that fails late must not drop the connection another request just made.
        const refusedBy = this.#active.get(hostId);
        const envelope = yield* this.#exchange(
          hostId,
          requestId,
          frame,
          init.timeoutMs ?? remoteWorkspaceReadTimeout(method, path),
        ).pipe(
          Effect.catchIf(
            (error) => !bodyTransferId && isClosedChannelError(error.cause),
            () =>
              Effect.gen({ self: this }, function* () {
                if (refusedBy?.connected && this.#active.get(hostId) === refusedBy) this.#onDisconnected(hostId);
                yield* this.#ensureConnected(hostId);
                return yield* this.#exchange(
                  hostId,
                  requestId,
                  frame,
                  init.timeoutMs ?? remoteWorkspaceReadTimeout(method, path),
                );
              }),
          ),
        );
        if (!isDynamicRecord(envelope) || !isNumber(envelope.status) || !Object.hasOwn(envelope, "body")) {
          return yield* new RemoteWorkflowError({
            cause: new TeamWebRtcRequestError(502, "protocol_error", "The host returned an invalid response."),
          });
        }
        const fileRecord = isDynamicRecord(envelope.file) ? envelope.file : null;
        const transferId = fileRecord && isString(fileRecord.transferId) ? fileRecord.transferId : null;
        const file = transferId ? yield* this.#files.consume(hostId, transferId) : undefined;
        // The envelope check above catches a frame that is not shaped like a response. This catches a
        // well-formed frame whose *body* the released V3 adapter refuses, which is the same kind of
        // failure and has to carry the same code: a plain error here reads to the caller as an ordinary
        // request failure, so the host stays healthy and reconnectable while talking nonsense.
        const status = envelope.status;
        const body = file
          ? null
          : yield* remoteDecode(() =>
              sideRoute
                ? sideRoute.response(path, status, envelope.body)
                : decodeTeamProtocolV6WebRtcHttpResponse(method, path, status, envelope.body),
            ).pipe(
              Effect.mapError(
                () =>
                  new RemoteWorkflowError({
                    cause: new TeamWebRtcRequestError(
                      502,
                      "protocol_error",
                      "The host returned an invalid response body.",
                    ),
                  }),
              ),
            );
        return { status: envelope.status, body, ...(file ? { file } : {}) };
      }),
    );
  }).bind(this);

  /** Sends one request frame and waits for its response. */
  readonly #exchange = Effect.fn("TeamWebRtcClient.exchange")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    requestId: string,
    frame: string,
    timeoutMs = TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, TeamClientBridge> {
    const result = Deferred.makeUnsafe<TeamProtocolV2Json, RemoteWorkflowError>();
    {
      const resolve = (value: TeamProtocolV2Json) => {
        Deferred.doneUnsafe(result, Effect.succeed(value));
      };
      const reject = (cause: Error) => {
        Deferred.doneUnsafe(result, Effect.fail(new RemoteWorkflowError({ cause })));
      };
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new TeamWebRtcRequestError(504, "remote_timeout", sourceText("error.remote.requestTimeout")));
      }, timeoutMs);
      this.#pending.set(requestId, { hostId, resolve, reject, timer });
    }
    // The cleanup covers the send too: an interrupted send must not leave the entry and its timer.
    return yield* Effect.gen({ self: this }, function* () {
      const sent = yield* TeamClientBridge.use((bridge) => bridge.send(hostId, "rpc", frame)).pipe(Effect.result);
      if (Result.isFailure(sent)) {
        const error = sent.failure.cause;
        const pending = this.#pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pending.delete(requestId);
          pending.reject(error instanceof Error ? error : new Error(sourceText("error.remote.requestFailed")));
        }
      }
      return yield* Deferred.await(result);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const pending = this.#pending.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.#pending.delete(requestId);
          }
        }),
      ),
    );
  });

  readonly disconnect = Effect.fn("TeamWebRtcClient.disconnect")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(this.#close(hostId, "end"));
  }).bind(this);

  /** Forgets the sessions kept for the next run, such as at sign-out or when another account signs in. */
  forgetStoredSessions(): Effect.Effect<void> {
    return this.#options.sessionCache?.clear() ?? Effect.void;
  }

  /**
   * Closes the connection to a host. `end` also ends its session, and forgets it for the next run.
   * `keep` leaves the session open and kept, for the next run of the app.
   */
  readonly #close = Effect.fn("TeamWebRtcClient.close")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    session: "end" | "keep",
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    const active = this.#active.get(hostId);
    const sessionId = active?.sessionId || this.#retainedSessions.get(hostId)?.sessionId;
    if (active) {
      active.cancelled = true;
      if (session === "keep") active.released = true;
      active.cancelConnectionWait?.();
    }
    // A request sent before disconnect may have committed. Fail it without replaying the request.
    for (const [requestId, pending] of this.#pending) {
      if (pending.hostId !== hostId) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(requestId);
      pending.reject(
        new TeamWebRtcRequestError(503, "remote_disconnected", sourceText("error.remote.hostDisconnected")),
      );
    }
    if (active?.expirationTimer) clearTimeout(active.expirationTimer);
    this.#active.delete(hostId);
    this.#retainedSessions.delete(hostId);
    this.#files.setPeerAuthenticated(hostId, false);
    const disconnected = yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.result);
    const disconnectError = Result.isFailure(disconnected) ? disconnected.failure.cause : undefined;
    if (session === "end") {
      // Before the session ends: a kept session that ended only costs the next start a request.
      if (this.#options.sessionCache) yield* this.#options.sessionCache.delete(hostId);
      if (sessionId)
        yield* this.#options
          .endSession(sessionId)
          .pipe(toRemoteWorkflowError)
          .pipe(Effect.catch(() => Effect.void));
    }
    if (disconnectError) return yield* new RemoteWorkflowError({ cause: disconnectError });
  });

  #owned<A>(operation: Effect.Effect<A, RemoteWorkflowError, TeamClientBridge>): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      if (this.#stopped)
        return Effect.fail(
          new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.connectionCancelled")) }),
        );
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.provide(this.#platform),
        Effect.ensuring(
          Effect.sync(() => this.#operations.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  }

  readonly stop = Effect.fn("TeamWebRtcClient.stop")(function* (this: TeamWebRtcClientTransport) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const done = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = done;
    return yield* Effect.gen({ self: this }, function* () {
      const hostIds = new Set([...this.#active.keys(), ...this.#retainedSessions.keys()]);
      // The app quits. A session that the next run can read stays open for it: the account service
      // gives this device the same session again in any case, so ending it only costs the next start
      // a request. Every other session ends, as before: without a cache, with the setting off, or
      // when the cache does not hold it.
      yield* Effect.forEach(
        [...hostIds],
        (hostId) =>
          this.#owned(this.#close(hostId, this.#keptForNextRun(hostId) ? "keep" : "end")).pipe(
            Effect.catch(() => Effect.void),
          ),
        { concurrency: "unbounded" },
      );
      this.#options.bridge.off("connected", this.#onConnected);
      this.#options.bridge.off("disconnected", this.#onDisconnected);
      this.#options.bridge.off("data", this.#onData);
      this.#options.bridge.off("path", this.#onPath);
      this.#options.bridge.off("error", this.#onError);
      this.#options.bridge.off("signalReady", this.#onSignalReady);
      this.#options.bridge.off("signalOpen", this.#onSignalOpen);
      // A connect that waits for host keys is cancelled now, but it ends only after this wait.
      this.endHostKeySync();
      yield* this.#files.stop();
      while (this.#operations.size)
        yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
      this.#stopped = true;
    }).pipe(Effect.onExit((exit) => Deferred.done(done, exit)));
  }).bind(this);

  /** Whether a transfer is moving right now, either direction. */
  hasActiveTransfers(): boolean {
    return this.#files.hasActiveTransfers();
  }

  readonly #ensureConnected = Effect.fn("TeamWebRtcClient.ensureConnected")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    const sessionCache = this.#options.sessionCache;
    if (sessionCache) yield* sessionCache.load();
    const principalId = this.#options.getPrincipalId();
    let current: ActiveHost | RetainedSession | undefined =
      this.#active.get(hostId) ?? this.#retainedSessions.get(hostId);
    let storedSession = false;
    if (!current && sessionCache) {
      const stored = sessionCache.get(principalId, hostId);
      // A session of the last run. The account service refuses it if it ended; then a new one starts.
      if (stored && stored.expiresAt > Date.now() + 30_000) {
        current = { ...stored, principalId, connected: false, connecting: null };
        storedSession = true;
      }
    }
    if (current?.expiresAt && current.expiresAt <= Date.now() + 30_000) {
      yield* this.disconnect(hostId);
      current = undefined;
    }
    if (current && current.principalId !== principalId) {
      yield* this.disconnect(hostId);
      current = undefined;
    }
    if (current?.connected) return;
    const connecting = current?.connecting;
    if (connecting) return yield* Deferred.await(connecting);
    const active: ActiveHost = {
      sessionId: current?.sessionId ?? "",
      expiresAt: current?.expiresAt ?? 0,
      principalId,
      connected: false,
      connecting: null,
      cancelled: false,
      released: false,
      cancelConnectionWait: null,
      expirationTimer: null,
      authentication: null,
    };
    const done = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    active.connecting = done;
    this.#retainedSessions.delete(hostId);
    this.#active.set(hostId, active);
    this.#options.connectTrace?.begin(hostId);
    return yield* this.#connect(hostId, active, current?.sessionId || null, storedSession).pipe(
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.onError(() =>
        Effect.sync(() => {
          this.#options.connectTrace?.fail(hostId, active.cancelled ? "cancelled" : "error");
          if (this.#active.get(hostId) === active) this.#active.delete(hostId);
        }),
      ),
    );
  });

  readonly #connect = Effect.fn("TeamWebRtcClient.connect")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    active: ActiveHost,
    existingSessionId: string | null,
    storedSession: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    let hostPublicKey = this.#hostPublicKeys.get(hostId);
    const hostKeySync = this.#hostKeySync;
    if (!hostPublicKey && hostKeySync) {
      yield* Deferred.await(hostKeySync);
      if (active.cancelled || this.#active.get(hostId) !== active)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.connectionCancelled")) });
      hostPublicKey = this.#hostPublicKeys.get(hostId);
    }
    if (!hostPublicKey)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.pinnedKeyMissing")) });
    const connectTrace = this.#options.connectTrace;
    // The hidden window of the bridge loads while the control plane makes the session and the ticket.
    // `bridge.connect` below waits for the same start. A failure here is not this attempt's failure:
    // `bridge.connect` starts the window again and reports its own error.
    yield* Effect.forkChild(
      TeamClientBridge.use((bridge) => bridge.start()).pipe(
        Effect.tap(() => Effect.sync(() => connectTrace?.mark(hostId, "bridge"))),
        Effect.ignore,
      ),
      { startImmediately: true },
    );
    // The Signal socket opens while the ticket is made, at the address of the last ticket. The hello
    // with the ticket goes on it only when the ticket names the same address. A failure is ignored:
    // `bridge.connect` then opens its own socket, as before.
    const preparedSignalUrl = this.#options.sessionCache?.signalUrl(active.principalId) ?? this.#signalUrl;
    const preparingSignal = preparedSignalUrl
      ? yield* Effect.forkChild(
          TeamClientBridge.use((bridge) => bridge.prepareSignal(hostId, preparedSignalUrl)).pipe(Effect.ignore),
          { startImmediately: true },
        )
      : null;
    const clientKeys = yield* remoteDecode(() =>
      generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      }),
    );
    const clientPublicKey = clientKeys.publicKey.trim();
    let sessionId = existingSessionId;
    let startedNewSession = false;
    const bootstrap = yield* Effect.gen({ self: this }, function* () {
      if (!sessionId) {
        const session = yield* this.#options.startSession(hostId).pipe(toRemoteWorkflowError);
        sessionId = session.sessionId;
        active.sessionId = sessionId;
        active.expiresAt = session.expiresAt;
        startedNewSession = true;
        yield* this.#assertCurrentEffect(hostId, active, sessionId);
        connectTrace?.mark(hostId, "session");
      } else connectTrace?.mark(hostId, "session", storedSession ? "stored" : "reused");
      const ticketSessionId = sessionId;
      return yield* Effect.gen({ self: this }, function* () {
        const ticket = yield* this.#options.issueTicket(ticketSessionId, clientPublicKey).pipe(toRemoteWorkflowError);
        yield* this.#assertCurrentEffect(hostId, active, ticketSessionId);
        connectTrace?.mark(hostId, "ticket");
        return ticket;
      }).pipe(
        Effect.catch((failure) =>
          Effect.gen({ self: this }, function* () {
            // Only an ended session is replaced. Other failures keep it for the next ticket request.
            if (!existingSessionId || !isEndedSessionError(failure.cause)) return yield* failure;
            yield* this.#options
              .endSession(existingSessionId)
              .pipe(toRemoteWorkflowError)
              .pipe(Effect.catch(() => Effect.void));
            const session = yield* this.#options.startSession(hostId).pipe(toRemoteWorkflowError);
            sessionId = session.sessionId;
            active.sessionId = sessionId;
            active.expiresAt = session.expiresAt;
            startedNewSession = true;
            yield* this.#assertCurrentEffect(hostId, active, session.sessionId);
            const ticket = yield* this.#options
              .issueTicket(session.sessionId, clientPublicKey)
              .pipe(toRemoteWorkflowError);
            yield* this.#assertCurrentEffect(hostId, active, session.sessionId);
            return ticket;
          }),
        ),
      );
    }).pipe(
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          // The prepared Signal socket would stay open until its lifetime ends. `disconnect` closes
          // it. A newer attempt for this host owns the peer, so only the current attempt closes it.
          // The prepare stops first, so that its command cannot arrive after the disconnect.
          if (preparingSignal) yield* Fiber.interrupt(preparingSignal);
          if (preparingSignal && this.#active.get(hostId) === active)
            yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
          const failedSessionId = sessionId;
          if (failedSessionId && !active.released && !this.#retainSession(hostId, active, failedSessionId)) {
            yield* this.#options
              .endSession(failedSessionId)
              .pipe(toRemoteWorkflowError)
              .pipe(Effect.catch(() => Effect.void));
          }
          return yield* failure;
        }),
      ),
    );
    if (startedNewSession) this.#lastEventSequence.delete(hostId);
    const connectedSessionId = active.sessionId;
    this.#signalUrl = bootstrap.signalUrl;
    if (this.#options.sessionCache && this.#active.get(hostId) === active && !active.cancelled)
      yield* this.#options.sessionCache.set(
        active.principalId,
        hostId,
        { sessionId: connectedSessionId, expiresAt: active.expiresAt },
        bootstrap.signalUrl,
      );
    let cleanupConnectionWait: () => void = () => undefined;
    // Subscribe before bridge.connect: a bridge can deliver authentication events before it resolves.
    const connected = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    {
      const resolve = () => {
        Deferred.doneUnsafe(connected, Effect.void);
      };
      const reject = (cause: Error) => {
        Deferred.doneUnsafe(connected, Effect.fail(new RemoteWorkflowError({ cause })));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off("connected", onConnected);
        this.off("error", onError);
      };
      cleanupConnectionWait = cleanup;
      active.cancelConnectionWait = () => {
        cleanup();
        reject(new Error(sourceText("error.remote.connectionCancelled")));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(sourceText("error.remote.hostDidNotConnect")));
      }, 30_000);
      const onConnected = (connectedHostId: string) => {
        if (connectedHostId !== hostId) return;
        cleanup();
        resolve();
      };
      const onError = (failedHostId: string, _code: string, message: string) => {
        if (failedHostId !== hostId) return;
        cleanup();
        reject(new Error(message));
      };
      this.on("connected", onConnected);
      this.on("error", onError);
    }
    active.authentication = {
      ticket: bootstrap.ticket,
      clientPublicKey,
      clientPrivateKey: clientKeys.privateKey,
      clientNonce: yield* remoteDecode(() => randomBytes(32).toString("base64url")),
      hostPublicKey,
      binding: null,
      started: false,
      completed: false,
      hostNonce: null,
    };
    yield* Effect.gen({ self: this }, function* () {
      yield* TeamClientBridge.use((bridge) =>
        bridge.connect({
          peerId: hostId,
          signalUrl: bootstrap.signalUrl,
          token: bootstrap.ticket,
          peer: "client",
        }),
      );
      yield* this.#assertCurrentEffect(hostId, active, connectedSessionId);
      yield* Deferred.await(connected);
      this.#scheduleExpiration(hostId, active);
    }).pipe(
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          const retained = this.#retainSession(hostId, active, connectedSessionId);
          if (this.#active.get(hostId) === active) this.#active.delete(hostId);
          yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
          if (!retained && !active.released)
            yield* this.#options
              .endSession(connectedSessionId)
              .pipe(toRemoteWorkflowError)
              .pipe(Effect.catch(() => Effect.void));
          return yield* failure;
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          cleanupConnectionWait();
          active.cancelConnectionWait = null;
        }),
      ),
    );
  });

  #keptForNextRun(hostId: string): boolean {
    const cache = this.#options.sessionCache;
    const current = this.#active.get(hostId) ?? this.#retainedSessions.get(hostId);
    if (!cache?.canPersist() || !current?.sessionId) return false;
    return cache.get(current.principalId, hostId)?.sessionId === current.sessionId;
  }

  /** Keeps the session of an attempt that failed on its own. A cancelled attempt ends its session. */
  #retainSession(hostId: string, active: ActiveHost, sessionId: string): boolean {
    if (active.cancelled || this.#active.get(hostId) !== active) return false;
    this.#retainedSessions.set(hostId, {
      sessionId,
      expiresAt: active.expiresAt,
      principalId: active.principalId,
      connected: false,
      connecting: null,
    });
    return true;
  }

  readonly #assertCurrentEffect = Effect.fn("TeamWebRtcClient.assertCurrent")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    active: ActiveHost,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    if (!active.cancelled && this.#active.get(hostId) === active) return;
    yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
    if (!active.released)
      yield* this.#options
        .endSession(sessionId)
        .pipe(toRemoteWorkflowError)
        .pipe(Effect.catch(() => Effect.void));
    return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.connectionCancelled")) });
  });

  readonly #sendEventControlEffect = Effect.fn("TeamWebRtcClient.sendEventControl")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    control: TeamProtocolV1CurrentEventControl,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    yield* this.#ensureConnected(hostId);
    yield* TeamClientBridge.use((bridge) =>
      bridge.send(
        hostId,
        "events",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "event-control",
          control: toWireTeamProtocolV1ClientEvent(control),
        }),
      ),
    );
  });

  #scheduleExpiration(hostId: string, active: ActiveHost): void {
    if (active.expirationTimer) clearTimeout(active.expirationTimer);
    if (!active.expiresAt) return;
    const remaining = Math.max(0, active.expiresAt - Date.now() - 30_000);
    // Wait in bounded steps, exactly as the host schedules its half of the same session in
    // `#scheduleSessionExpiration`. An account session is persistent -- the control plane answers
    // `startSession` with `PERSISTENT_SESSION_EXPIRES_AT`, the largest date JavaScript has -- so the
    // delay is a quarter of a million years and overflows Node's signed 32-bit timer range. Node
    // resolves that by firing in one millisecond, which disconnected the client roughly as fast as
    // it finished authenticating: the channel closed under the first request, and the caller waited
    // out the full ten-minute request timeout for a frame that had nowhere to go.
    active.expirationTimer = setTimeout(
      () => {
        active.expirationTimer = null;
        if (this.#active.get(hostId) !== active) return;
        if (remaining > MAXIMUM_TIMER_DELAY_MILLISECONDS) this.#scheduleExpiration(hostId, active);
        else void Effect.runPromise(this.disconnect(hostId)).catch(() => undefined);
      },
      Math.min(remaining, MAXIMUM_TIMER_DELAY_MILLISECONDS),
    );
    active.expirationTimer.unref?.();
  }

  readonly #onSignalOpen = (hostId: string): void => {
    if (this.#active.has(hostId)) this.#options.connectTrace?.mark(hostId, "signal-socket");
  };

  readonly #onSignalReady = (hostId: string): void => {
    if (this.#active.has(hostId)) this.#options.connectTrace?.mark(hostId, "signal");
  };

  readonly #onConnected = (hostId: string, binding?: { localFingerprint: string; remoteFingerprint: string }): void => {
    if (this.#active.has(hostId)) this.#options.connectTrace?.mark(hostId, "channels");
    void Effect.runPromise(this.#owned(this.#beginAuthenticationEffect(hostId, binding))).catch(() => undefined);
  };
  readonly #beginAuthenticationEffect = Effect.fn("TeamWebRtcClient.beginAuthentication")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    binding?: { localFingerprint: string; remoteFingerprint: string },
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    const active = this.#active.get(hostId);
    if (!active) return;
    if (active.cancelled) {
      yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
      return;
    }
    const authentication = active.authentication;
    if (!binding) {
      this.#failProtocol(hostId, "The WebRTC channel binding is unavailable.");
      return;
    }
    if (!authentication || authentication.started) return;
    authentication.started = true;
    authentication.binding = binding;
    const transcript = teamProtocolV2AuthenticationTranscript({
      hostId,
      sessionId: active.sessionId,
      ticket: authentication.ticket,
      clientPublicKey: authentication.clientPublicKey,
      clientNonce: authentication.clientNonce,
      clientFingerprint: binding.localFingerprint,
      hostFingerprint: binding.remoteFingerprint,
    });
    yield* remoteDecode(() =>
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "auth-init",
        ticket: authentication.ticket,
        clientPublicKey: authentication.clientPublicKey,
        clientNonce: authentication.clientNonce,
        signature: sign(null, Buffer.from(transcript), authentication.clientPrivateKey).toString("base64url"),
      }),
    ).pipe(
      Effect.flatMap((frame) => TeamClientBridge.use((bridge) => bridge.send(hostId, "rpc", frame))),
      Effect.catch(() => Effect.sync(() => this.#failProtocol(hostId, "The client authentication handshake failed."))),
    );
  });

  #finishConnected(hostId: string, active: ActiveHost): void {
    this.#files.setPeerAuthenticated(hostId, true);
    active.connected = true;
    active.connecting = null;
    this.#options.connectTrace?.mark(hostId, "auth");
    this.#sendRecoverable(
      hostId,
      "events",
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "event-ack",
        throughSequence: this.#lastEventSequence.get(hostId) ?? 0,
      }),
    );
    this.emit("connected", hostId);
  }

  readonly #onDisconnected = (hostId: string): void => {
    const active = this.#active.get(hostId);
    if (!active) return;
    this.#files.setPeerAuthenticated(hostId, false);
    active.connected = false;
    this.#lastEventSequence.delete(hostId);
    for (const [requestId, pending] of this.#pending) {
      if (pending.hostId !== hostId) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(requestId);
      pending.reject(
        new TeamWebRtcRequestError(503, "remote_disconnected", sourceText("error.remote.hostDisconnected")),
      );
    }
    this.emit("disconnected", hostId);
  };

  readonly #onData = (
    hostId: string,
    channel: "rpc" | "events" | "files" | "desktop",
    data: string | ArrayBuffer,
  ): void => {
    const active = this.#active.get(hostId);
    if (!active) return;
    const authFrame = isString(data) && channel === "rpc" ? authenticationFrame(data) : null;
    if (!active?.connected && authFrame?.type !== "auth-ready" && authFrame?.type !== "auth-confirmed") {
      this.#failProtocol(hostId, "The host sent data before end-to-end authentication.");
      return;
    }
    if (channel === "desktop") {
      this.emit("desktopData", hostId, data);
      return;
    }
    if (!isString(data)) {
      if (channel === "rpc" || channel === "events") {
        this.#failProtocol(hostId, `The host returned binary data on the ${channel} channel.`);
      }
      return;
    }
    if (authFrame?.type === "auth-ready")
      void Effect.runPromise(this.#owned(this.#handleAuthentication(hostId, authFrame))).catch(() => undefined);
    else if (authFrame?.type === "auth-confirmed") this.#handleAuthenticationConfirmation(hostId, authFrame);
    else if (channel === "rpc") this.#handleRpc(hostId, data);
    else if (channel === "events") this.#handleEvent(hostId, data);
  };

  readonly #handleAuthentication = Effect.fn("TeamWebRtcClient.handleAuthentication")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    frame: Extract<TeamProtocolV2AuthFrame, { type: "auth-ready" }>,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    return yield* Effect.gen({ self: this }, function* () {
      const active = this.#active.get(hostId);
      const authentication = active?.authentication;
      if (!active || !authentication?.binding || active.connected || authentication.completed) {
        return yield* new RemoteWorkflowError({ cause: new Error("Authentication is not pending.") });
      }
      if (frame.clientNonce !== authentication.clientNonce) {
        return yield* new RemoteWorkflowError({
          cause: new Error("The host authentication response does not match the request."),
        });
      }
      const transcript = teamProtocolV2AuthenticationTranscript({
        hostId,
        sessionId: active.sessionId,
        ticket: authentication.ticket,
        clientPublicKey: authentication.clientPublicKey,
        clientNonce: authentication.clientNonce,
        hostNonce: frame.hostNonce,
        clientFingerprint: authentication.binding.localFingerprint,
        hostFingerprint: authentication.binding.remoteFingerprint,
      });
      if (
        !(yield* remoteDecode(() =>
          verify(
            null,
            Buffer.from(transcript),
            authentication.hostPublicKey,
            Buffer.from(frame.signature, "base64url"),
          ),
        ))
      ) {
        return yield* new RemoteWorkflowError({ cause: new Error("The host device signature is invalid.") });
      }
      authentication.completed = true;
      authentication.hostNonce = frame.hostNonce;
      yield* TeamClientBridge.use((bridge) =>
        bridge.send(
          hostId,
          "rpc",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "auth-complete",
            clientNonce: authentication.clientNonce,
            hostNonce: frame.hostNonce,
          }),
        ),
      );
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          this.#failProtocol(hostId, "The host failed end-to-end authentication.");
        }),
      ),
    );
  });

  #handleAuthenticationConfirmation(
    hostId: string,
    frame: Extract<TeamProtocolV2AuthFrame, { type: "auth-confirmed" }>,
  ): void {
    const active = this.#active.get(hostId);
    const authentication = active?.authentication;
    if (
      !active ||
      !authentication?.completed ||
      active.connected ||
      frame.clientNonce !== authentication.clientNonce ||
      frame.hostNonce !== authentication.hostNonce
    ) {
      this.#failProtocol(hostId, "The host returned an invalid authentication confirmation.");
      return;
    }
    this.#finishConnected(hostId, active);
  }

  #handleRpc(hostId: string, data: string): void {
    let frame: TeamProtocolV2RpcFrame;
    try {
      frame = decodeTeamProtocolV2RpcFrame(data);
    } catch {
      this.#failProtocol(hostId, "The host returned an invalid RPC frame.");
      return;
    }
    if (frame.type !== "response") {
      this.#failProtocol(hostId, "The host returned a client RPC frame on the RPC channel.");
      return;
    }
    const pending = this.#pending.get(frame.requestId);
    if (!pending || pending.hostId !== hostId) return;
    clearTimeout(pending.timer);
    this.#pending.delete(frame.requestId);
    if ("error" in frame) {
      pending.reject(new TeamWebRtcRequestError(frame.error.status ?? 500, frame.error.code, frame.error.message));
    } else pending.resolve(frame.result);
  }

  #handleEvent(hostId: string, data: string): void {
    try {
      const frame = decodeTeamProtocolV2EventFrame(data);
      if (frame.type === "event-reset") {
        this.#lastEventSequence.set(hostId, frame.nextSequence - 1);
        this.#sendRecoverable(
          hostId,
          "events",
          encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: frame.nextSequence - 1 }),
        );
        this.#sendRecoverable(
          hostId,
          "events",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "event-control",
            control: { type: "runtime-snapshot-request" },
          }),
        );
        return;
      }
      if (frame.type !== "event") {
        this.#failProtocol(hostId, "The host returned a client event frame on the event channel.");
        return;
      }
      const lastSequence = this.#lastEventSequence.get(hostId) ?? 0;
      if (frame.sequence <= lastSequence) {
        this.#sendRecoverable(
          hostId,
          "events",
          encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: lastSequence }),
        );
        return;
      }
      if (frame.sequence !== lastSequence + 1) {
        this.#failProtocol(hostId, sourceText("error.remote.eventGap"));
        return;
      }
      const optional = frame.type === "event" ? optionalTeamEvent(frame.payload) : null;
      const decoded = optional
        ? { status: "known" as const, event: optional }
        : decodeTeamProtocolV6CurrentEvent(frame);
      if (decoded.status === "invalid") {
        this.#failProtocol(hostId, sourceText("error.remote.malformedKnownEvent"));
        return;
      }
      if (decoded.status === "known") this.emit("event", hostId, decoded.event);
      this.#lastEventSequence.set(hostId, frame.sequence);
      this.#sendRecoverable(
        hostId,
        "events",
        encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: frame.sequence }),
      );
    } catch {
      this.#failProtocol(hostId, "The host returned an invalid event frame.");
    }
  }

  #failProtocol(hostId: string, message: string): void {
    this.#files.setPeerAuthenticated(hostId, false);
    const error = new TeamWebRtcRequestError(502, "protocol_error", message);
    for (const [requestId, pending] of this.#pending) {
      if (pending.hostId !== hostId) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(requestId);
      pending.reject(error);
    }
    this.emit("error", hostId, error.code, error.message);
    void Effect.runPromise(this.disconnect(hostId)).catch(() => undefined);
  }

  readonly #onPath = (hostId: string, path: "p2p" | "relay"): void => {
    if (!this.#active.has(hostId)) return;
    this.emit("path", hostId, path);
  };
  readonly #onError = (hostId: string, code: string, message: string): void => {
    if (!this.#active.has(hostId)) return;
    this.emit("error", hostId, code, message);
  };

  #sendRecoverable(hostId: string, channel: "events", data: string): void {
    void Effect.runPromise(
      this.#owned(
        TeamClientBridge.use((bridge) => bridge.send(hostId, channel, data)).pipe(Effect.catch(() => Effect.void)),
      ),
    );
  }
}

export class TeamWebRtcRequestError extends Schema.TaggedError<TeamWebRtcRequestError>()("TeamWebRtcRequestError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

function authenticationFrame(data: string): TeamProtocolV2AuthFrame | null {
  try {
    return decodeTeamProtocolV2AuthFrame(data);
  } catch {
    return null;
  }
}

function binaryBody(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/**
 * The bridge refused a frame because the data channel is closed. No byte of the frame left. A host
 * error response is a `TeamWebRtcRequestError` with the host's message, so it never matches.
 */
function isClosedChannelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof TeamWebRtcRequestError) &&
    error.message === sourceText("error.remote.channelNotOpen")
  );
}

/** The account API answers 403 or 404 for a session that ended, expired, or does not exist. */
function isEndedSessionError(error: unknown): boolean {
  return error instanceof Error && "status" in error && (error.status === 403 || error.status === 404);
}
