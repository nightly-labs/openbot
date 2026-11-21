import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolSupportExpanded,
  teamCapabilitiesForProtocol,
  teamCapabilityLists,
} from "@openbot/contracts/team-protocol/current";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { addSkillSuggestionNames } from "@openbot/contracts/team-protocol/skill-learning-v1";
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
import { decodeTeamProtocolV8CurrentEvent } from "@openbot/contracts/team-protocol/v8-webrtc-adapter";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { encodeTeamProtocolV9WebRtcHttpRequest } from "@openbot/contracts/team-protocol/v9-webrtc-adapter";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { decodeTeamProtocolV10WebRtcHttpResponse } from "@openbot/contracts/team-protocol/v10-webrtc-adapter";
import { sourceText } from "@openbot/i18n/source";
import { remoteWorkspaceReadTimeout, startRemoteRequestDeadline } from "@openbot/team-client/remote-recovery";
import { type RemoteRequestProfile, startRemoteRequest } from "@openbot/team-client/sync-profile";
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
import { LOCAL_TEAM_PROTOCOL, transportFailure } from "./remote-server-connection-status";
import {
  type RemoteFileProgress,
  RemoteWorkflowError,
  remoteDecode,
  toRemoteWorkflowError,
} from "./remote-service-effects";
import type { RemoteSessionCache } from "./remote-session-cache";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcFileTransfer } from "./team-webrtc-file-transfer";

export const TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS = 10 * 60_000 + 30_000;

const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

const CONNECT_RETRY_START_MILLISECONDS = 500;
const CONNECT_RETRY_LIMIT_MILLISECONDS = 30_000;

const CONNECT_LIMIT_MILLISECONDS = 30_000;
const HOST_WAIT_LIMIT_MILLISECONDS = 60_000;

interface TeamWebRtcClientTransportEvents {
  connected: [hostId: string];
  disconnected: [hostId: string];
  event: [hostId: string, event: AgentEvent | TeamRealtimeEvent];
  path: [hostId: string, path: "p2p" | "relay"];
  error: [hostId: string, code: string, message: string];
  connectFailed: [hostId: string, failure: unknown];
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
  removeOwnedHost: (hostId: string) => Effect.Effect<void, CentralAuthOperationError>;
  getPrincipalId: () => string;
  controlPlaneUrl: string;
  downloadHostLogo: (
    hostId: string,
    version: string,
  ) => Effect.Effect<{ bytes: Uint8Array; mimeType: string }, CentralAuthOperationError>;
  transferDirectory: string;
  connectTrace?: RemoteConnectTrace;
  sessionCache?: RemoteSessionCache;
  developmentRoundTripMs?: number;
  developmentDownlinkKbps?: number;
}

type DataListener = (
  hostId: string,
  channel: "rpc" | "events" | "files" | "desktop",
  data: string | ArrayBuffer,
) => void;

function developmentLink(listener: DataListener, halfRoundTripMs: number, downlinkKbps: number): DataListener {
  if (halfRoundTripMs <= 0 && downlinkKbps <= 0) return listener;
  let linkFreeAt = 0;
  return (hostId, channel, data) => {
    const now = performance.now();
    const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    linkFreeAt = Math.max(now, linkFreeAt) + (downlinkKbps > 0 ? (bytes * 8) / downlinkKbps : 0);
    setTimeout(() => listener(hostId, channel, data), linkFreeAt - now + halfRoundTripMs);
  };
}

interface ActiveHost {
  sessionId: string;
  expiresAt: number;
  principalId: string;
  connected: boolean;
  connecting: Deferred.Deferred<void, RemoteWorkflowError> | null;
  cancelled: boolean;
  released: boolean;
  cancelConnectionWait: ((cause?: Error) => void) | null;
  expirationTimer: ReturnType<typeof setTimeout> | null;
  protocolProbe: Deferred.Deferred<void> | null;
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
  readonly #hostProtocols = new Map<string, number>();
  readonly #active = new Map<string, ActiveHost>();
  readonly #retainedSessions = new Map<string, RetainedSession>();
  readonly #connectRetries = new Map<string, { failure: RemoteWorkflowError; failures: number; retryAt: number }>();
  readonly #closes = new Map<string, number>();
  readonly #files: TeamWebRtcFileTransfer;
  readonly #pending = new Map<
    string,
    {
      hostId: string;
      resolve: (value: TeamProtocolV2Json) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      profile: RemoteRequestProfile | null;
    }
  >();
  readonly #lastAnswerAt = new Map<string, number>();
  readonly #lastEventSequence = new Map<string, number>();
  readonly #hostPublicKeys = new Map<string, string>();
  #hostKeySync: Deferred.Deferred<void> | null = null;
  #signalUrl: string | null = null;
  readonly #waitForHost = new Set<string>();

  constructor(options: TeamWebRtcClientTransportOptions) {
    super();
    const roundTrip = options.developmentRoundTripMs ?? 0;
    const half = roundTrip / 2;
    this.#options =
      roundTrip > 0
        ? {
            ...options,
            listHosts: () => Effect.delay(options.listHosts(), roundTrip),
            startSession: (hostId) => Effect.delay(options.startSession(hostId), roundTrip),
            issueTicket: (sessionId, key) => Effect.delay(options.issueTicket(sessionId, key), roundTrip),
          }
        : options;
    this.#platform = Layer.succeed(
      TeamClientBridge,
      TeamClientBridge.of({
        start: () => options.bridge.start(),
        prepareSignal: (peerId, signalUrl) => options.bridge.prepareSignal(peerId, signalUrl),
        send: (...args) => (half > 0 ? Effect.delay(options.bridge.send(...args), half) : options.bridge.send(...args)),
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
    options.bridge.on("data", developmentLink(this.#onData, half, options.developmentDownlinkKbps ?? 0));
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

  setWaitForHost(hostId: string, wait: boolean): void {
    if (wait) this.#waitForHost.add(hostId);
    else this.#waitForHost.delete(hostId);
  }

  pinHostKey(hostId: string, publicKey: string): void {
    this.#hostPublicKeys.set(hostId, publicKey);
  }

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

  readonly removeOwnedHost = Effect.fn("TeamWebRtcClient.removeOwnedHost")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const host = (yield* this.#options.listHosts().pipe(toRemoteWorkflowError)).find(
          (candidate) => candidate.hostId === hostId,
        );
        if (!host) return;
        if (host.role !== "owner")
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.ownerOnlyRemove")) });
        yield* this.#options.removeOwnedHost(hostId).pipe(toRemoteWorkflowError);
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
    return this.#owned(this.#ensureConnected(hostId, true));
  }

  retry(hostId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.#owned(
      Effect.gen({ self: this }, function* () {
        const checked = this.#active.get(hostId);
        if (checked?.connected) {
          const answer = yield* this.requestResponse(hostId, "/v1/compatibility").pipe(Effect.result);
          if (Result.isSuccess(answer)) return;
          const timedOut =
            answer.failure.cause instanceof TeamWebRtcRequestError && answer.failure.cause.code === "remote_timeout";
          if (timedOut && checked.connected && this.#active.get(hostId) === checked) {
            this.#onDisconnected(hostId);
            yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.ignore);
          }
        }
        yield* this.#ensureConnected(hostId, true);
      }),
    );
  }

  isConnected(hostId: string): boolean {
    return this.#active.get(hostId)?.connected === true;
  }

  readonly request = Effect.fn("TeamWebRtcClient.request")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    path: string,
    init: {
      method?: string | undefined;
      body?: unknown;
      preserveSemanticTags?: boolean | undefined;
      agentCreateModel?: boolean | undefined;
      timeoutMs?: number | undefined;
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
      method?: string | undefined;
      body?: unknown;
      contentType?: string | undefined;
      preserveSemanticTags?: boolean | undefined;
      agentCreateModel?: boolean | undefined;
      timeoutMs?: number | undefined;
      fileProgress?: RemoteFileProgress | undefined;
      uploadProgress?: ((sent: number, total: number) => void) | undefined;
    } = {},
  ): Effect.fn.Return<
    {
      status: number;
      body: TeamProtocolV2Json;
      file?: { bytes: Uint8Array; name: string; mimeType: string };
    },
    RemoteWorkflowError
  > {
    let profile: RemoteRequestProfile | null = null;
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        yield* this.#ensureConnected(hostId);
        const method = (init.method ?? "GET").toUpperCase();
        const timeoutMs = init.timeoutMs ?? remoteWorkspaceReadTimeout(method, path);
        const startedAt = Date.now();
        if (path !== "/v1/compatibility") yield* this.#learnHostProtocol(hostId, timeoutMs);
        const remainingMs = timeoutMs === undefined ? undefined : timeoutMs - (Date.now() - startedAt);
        if (remainingMs !== undefined && remainingMs <= 0) {
          return yield* new RemoteWorkflowError({
            cause: new TeamWebRtcRequestError(504, "remote_timeout", sourceText("error.remote.requestTimeout")),
          });
        }
        const binary = binaryBody(init.body);
        const sideRoute = teamSideRouteCodec(path);
        const knownProtocol = this.#hostProtocols.get(hostId);
        const capabilityProtocol =
          path !== "/v1/compatibility" || (knownProtocol !== undefined && knownProtocol >= TEAM_PROTOCOL_V10)
            ? knownProtocol
            : undefined;
        const bodyTransferId = binary
          ? yield* this.#files.send(hostId, {
              name: "upload",
              mimeType: init.contentType ?? "application/octet-stream",
              bytes: binary,
              onProgress: init.uploadProgress,
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
                  ? sideRoute.request(path, init.body, {
                      channelIsolation: true,
                      channelPicture: true,
                      channelBrowser: true,
                      providerManyAccounts: true,
                    })
                  : encodeTeamProtocolV9WebRtcHttpRequest(method, path, init.body, {
                      ...(init.preserveSemanticTags === undefined
                        ? {}
                        : { preserveSemanticTags: init.preserveSemanticTags }),
                      ...(init.agentCreateModel === undefined ? {} : { agentCreateModel: init.agentCreateModel }),
                    }),
              ...teamCapabilityLists(capabilityProtocol, teamCapabilitiesForProtocol(capabilityProtocol)),
              ...(bodyTransferId ? { bodyTransferId } : {}),
              ...(init.contentType ? { contentType: init.contentType } : {}),
            },
          }),
        );
        profile = startRemoteRequest(method, path, frame);
        const refusedBy = this.#active.get(hostId);
        const progress = init.fileProgress;
        const watch = progress ? this.#files.watchIncoming(hostId, progress.size, progress.onProgress) : null;
        const envelope = yield* this.#exchange(hostId, requestId, frame, profile, remainingMs).pipe(
          Effect.catchIf(
            (error) => !bodyTransferId && isClosedChannelError(error.cause),
            () =>
              Effect.gen({ self: this }, function* () {
                if (refusedBy?.connected && this.#active.get(hostId) === refusedBy) this.#onDisconnected(hostId);
                yield* this.#ensureConnected(hostId);
                return yield* this.#exchange(hostId, requestId, frame, profile, timeoutMs);
              }),
          ),
          Effect.onInterrupt(() => watch?.stop ?? Effect.void),
          Effect.onError(() => Effect.sync(() => watch?.end(null))),
        );
        watch?.end(
          isDynamicRecord(envelope) && isDynamicRecord(envelope.file) && isString(envelope.file.transferId)
            ? envelope.file.transferId
            : null,
        );
        if (!isDynamicRecord(envelope) || !isNumber(envelope.status) || !Object.hasOwn(envelope, "body")) {
          return yield* new RemoteWorkflowError({
            cause: new TeamWebRtcRequestError(502, "protocol_error", "The host returned an invalid response."),
          });
        }
        const fileRecord = isDynamicRecord(envelope.file) ? envelope.file : null;
        const transferId = fileRecord && isString(fileRecord.transferId) ? fileRecord.transferId : null;
        const file = transferId ? yield* this.#files.consume(hostId, transferId) : undefined;
        const status = envelope.status;
        const body = file
          ? null
          : yield* remoteDecode(() =>
              sideRoute
                ? sideRoute.response(path, status, envelope.body, {
                    historyExtent: true,
                    channelAttention: true,
                    agentTaskUiBlocks: true,
                    channelIsolation: true,
                    channelPicture: true,
                    channelBrowser: true,
                    channelSeenSubtasks: true,
                    channelTaskWaits: true,
                    mcpManyServers: true,
                    providerManyAccounts: true,
                    routineResultsWhatsApp: true,
                    storageWorkflowFiles: true,
                  })
                : decodeTeamProtocolV10WebRtcHttpResponse(method, path, status, envelope.body),
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
        if (this.#sendsSkillSuggestionNames(hostId)) addSkillSuggestionNames(body, envelope.body);
        if (method === "GET" && path === "/v1/compatibility" && status === 200) {
          const support = yield* remoteDecode(() => decodeTeamProtocolSupportExpanded(body));
          this.#hostProtocols.set(hostId, Math.min(support.protocol.maximum, LOCAL_TEAM_PROTOCOL.maximum));
        }
        return { status: envelope.status, body, ...(file ? { file } : {}) };
      }).pipe(Effect.onExit((exit) => Effect.sync(() => profile?.end(exit)))),
    );
  }).bind(this);

  readonly #learnHostProtocol = Effect.fn("TeamWebRtcClient.learnHostProtocol")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    requestTimeoutMs: number | undefined,
  ): Effect.fn.Return<void> {
    const active = this.#active.get(hostId);
    if (!active || this.#hostProtocols.has(hostId)) return;
    if (active.protocolProbe) return yield* Deferred.await(active.protocolProbe);
    const probe = Deferred.makeUnsafe<void>();
    active.protocolProbe = probe;
    const readTimeoutMs = remoteWorkspaceReadTimeout("GET", "/v1/compatibility");
    const timeoutMs =
      requestTimeoutMs === undefined || readTimeoutMs === undefined
        ? readTimeoutMs
        : Math.min(requestTimeoutMs, readTimeoutMs);
    yield* this.requestResponse(hostId, "/v1/compatibility", timeoutMs === undefined ? {} : { timeoutMs }).pipe(
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(probe, Effect.void))),
    );
  }).bind(this);

  readonly #exchange = Effect.fn("TeamWebRtcClient.exchange")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    requestId: string,
    frame: string,
    profile: RemoteRequestProfile | null,
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
      const entry = {
        hostId,
        resolve,
        reject,
        profile,
        timer: startRemoteRequestDeadline(
          timeoutMs,
          () => this.#lastAnswerAt.get(hostId) ?? 0,
          () => {
            this.#pending.delete(requestId);
            reject(new TeamWebRtcRequestError(504, "remote_timeout", sourceText("error.remote.requestTimeout")));
          },
          (timer) => {
            entry.timer = timer;
          },
        ),
      };
      this.#pending.set(requestId, entry);
    }
    return yield* Effect.gen({ self: this }, function* () {
      const sending = yield* Effect.forkChild(
        Effect.gen({ self: this }, function* () {
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
        }),
        { startImmediately: true },
      );
      return yield* Deferred.await(result).pipe(Effect.ensuring(Fiber.interrupt(sending)));
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

  forgetStoredSessions(): Effect.Effect<void> {
    return this.#options.sessionCache?.clear() ?? Effect.void;
  }

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
    this.#connectRetries.delete(hostId);
    this.#closes.set(hostId, (this.#closes.get(hostId) ?? 0) + 1);
    this.#hostProtocols.delete(hostId);
    this.#lastAnswerAt.delete(hostId);
    this.#files.setPeerAuthenticated(hostId, false);
    const disconnected = yield* TeamClientBridge.use((bridge) => bridge.disconnect(hostId)).pipe(Effect.result);
    const disconnectError = Result.isFailure(disconnected) ? disconnected.failure.cause : undefined;
    if (session === "end") {
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
      this.endHostKeySync();
      yield* this.#files.stop();
      while (this.#operations.size)
        yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
      this.#stopped = true;
    }).pipe(Effect.onExit((exit) => Deferred.done(done, exit)));
  }).bind(this);

  hasActiveTransfers(): boolean {
    return this.#files.hasActiveTransfers();
  }

  readonly #ensureConnected = Effect.fn("TeamWebRtcClient.ensureConnected")(function* (
    this: TeamWebRtcClientTransport,
    hostId: string,
    retryNow = false,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamClientBridge> {
    const sessionCache = this.#options.sessionCache;
    if (sessionCache) yield* sessionCache.load();
    const principalId = this.#options.getPrincipalId();
    let current: ActiveHost | RetainedSession | undefined =
      this.#active.get(hostId) ?? this.#retainedSessions.get(hostId);
    let storedSession = false;
    if (!current && sessionCache) {
      const stored = sessionCache.get(principalId, hostId);
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
    const retry = this.#connectRetries.get(hostId);
    if (retry && !retryNow && Date.now() < retry.retryAt) return yield* retry.failure;
    if (this.#stopping)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.connectionCancelled")) });
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
      protocolProbe: null,
      authentication: null,
    };
    const done = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    active.connecting = done;
    this.#retainedSessions.delete(hostId);
    this.#hostProtocols.delete(hostId);
    this.#active.set(hostId, active);
    const closes = this.#closes.get(hostId) ?? 0;
    const attemptId = this.#options.connectTrace?.begin(hostId);
    return yield* this.#connect(hostId, active, current?.sessionId || null, storedSession).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          const newer = this.#active.get(hostId);
          if (active.cancelled || (newer && newer !== active) || (this.#closes.get(hostId) ?? 0) !== closes) return;
          const failures = (this.#connectRetries.get(hostId)?.failures ?? 0) + 1;
          const delay = Math.min(
            CONNECT_RETRY_LIMIT_MILLISECONDS,
            CONNECT_RETRY_START_MILLISECONDS * 2 ** (failures - 1),
          );
          this.#connectRetries.set(hostId, { failure, failures, retryAt: Date.now() + delay });
          this.emit("connectFailed", hostId, failure.cause);
        }),
      ),
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.onError(() =>
        Effect.sync(() => {
          if (attemptId !== undefined)
            this.#options.connectTrace?.fail(hostId, attemptId, active.cancelled ? "cancelled" : "error");
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
      return yield* new RemoteWorkflowError({
        cause: new TeamWebRtcConnectError("host_key_missing", sourceText("error.remote.hostKeyMissing")),
      });
    const connectTrace = this.#options.connectTrace;
    yield* Effect.forkChild(
      TeamClientBridge.use((bridge) => bridge.start()).pipe(
        Effect.tap(() => Effect.sync(() => connectTrace?.mark(hostId, "bridge"))),
        Effect.ignore,
      ),
      { startImmediately: true },
    );
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
    const stillCurrent = this.#active.get(hostId) === active && !active.cancelled;
    if (stillCurrent) connectTrace?.signalHome(hostId, bootstrap.ticket);
    if (this.#options.sessionCache && stillCurrent)
      yield* this.#options.sessionCache.set(
        active.principalId,
        hostId,
        { sessionId: connectedSessionId, expiresAt: active.expiresAt },
        bootstrap.signalUrl,
      );
    let cleanupConnectionWait: () => void = () => undefined;
    const waitForHost = this.#waitForHost.has(hostId);
    const connected = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    {
      const bridge = this.#options.bridge;
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
        bridge.off("hostWaiting", onHostWaiting);
        bridge.off("signalReady", onSignalReady);
      };
      cleanupConnectionWait = cleanup;
      active.cancelConnectionWait = (cause = new Error(sourceText("error.remote.connectionCancelled"))) => {
        cleanup();
        reject(cause);
      };
      let signalReady = false;
      const timeOut = () => {
        cleanup();
        const stage = active.authentication?.started ? "auth" : signalReady ? "ice" : "signal";
        reject(
          new TeamWebRtcConnectError(
            `connect_timeout_${stage}`,
            sourceText(stage === "ice" ? "error.remote.iceFailed" : "error.remote.hostDidNotConnect"),
          ),
        );
      };
      let timer = setTimeout(timeOut, CONNECT_LIMIT_MILLISECONDS);
      let hostWaited = false;
      const onHostWaiting = (waitingHostId: string) => {
        if (waitingHostId !== hostId || hostWaited) return;
        hostWaited = true;
        clearTimeout(timer);
        timer = setTimeout(
          () => this.#onError(hostId, "host_unavailable", sourceText("error.remote.hostOffline")),
          HOST_WAIT_LIMIT_MILLISECONDS,
        );
      };
      const onSignalReady = (readyHostId: string) => {
        if (readyHostId !== hostId) return;
        signalReady = true;
        if (!hostWaited) return;
        hostWaited = false;
        clearTimeout(timer);
        timer = setTimeout(timeOut, CONNECT_LIMIT_MILLISECONDS);
      };
      const onConnected = (connectedHostId: string) => {
        if (connectedHostId !== hostId) return;
        cleanup();
        resolve();
      };
      const onError = (failedHostId: string, code: string, message: string) => {
        if (failedHostId !== hostId) return;
        cleanup();
        reject(new TeamWebRtcConnectError(code, message));
      };
      this.on("connected", onConnected);
      this.on("error", onError);
      bridge.on("signalReady", onSignalReady);
      if (waitForHost) bridge.on("hostWaiting", onHostWaiting);
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
          ...(waitForHost ? { waitForHost: true } : {}),
        }),
      ).pipe(
        Effect.mapError(
          () =>
            new RemoteWorkflowError({
              cause: new TeamWebRtcConnectError("bridge_failed", sourceText("error.remote.connectionNotStarted")),
            }),
        ),
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
    this.#connectRetries.delete(hostId);
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
    if (!active.connected && active.authentication?.started)
      active.cancelConnectionWait?.(
        new TeamWebRtcConnectError("host_disconnected", sourceText("error.remote.hostDisconnected")),
      );
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
    this.#lastAnswerAt.set(hostId, performance.now());
    const pending = this.#pending.get(frame.requestId);
    if (!pending || pending.hostId !== hostId) return;
    pending.profile?.responded(data);
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
      const optional = frame.type === "event" ? optionalTeamEvent(frame.payload, { agentTaskUiBlocks: true }) : null;
      const decoded = optional
        ? { status: "known" as const, event: optionalTeamEventToCurrent(optional) }
        : decodeTeamProtocolV8CurrentEvent(frame);
      if (decoded.status === "invalid") {
        this.#failProtocol(hostId, sourceText("error.remote.malformedKnownEvent"));
        return;
      }
      if (decoded.status === "known") {
        if (this.#sendsSkillSuggestionNames(hostId)) addSkillSuggestionNames(decoded.event, frame.payload);
        this.emit("event", hostId, decoded.event);
      }
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

  #sendsSkillSuggestionNames(hostId: string): boolean {
    return (this.#hostProtocols.get(hostId) ?? 0) >= TEAM_PROTOCOL_V9;
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

class TeamWebRtcConnectError extends Schema.TaggedError<TeamWebRtcConnectError>()("TeamWebRtcConnectError", {
  code: Schema.String,
  message: Schema.String,
  reference: Schema.NullOr(Schema.String),
}) {
  constructor(code: string, message: string) {
    const failure = transportFailure(code, message);
    super({ code, message: failure.message, reference: failure.reference });
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

function isClosedChannelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof TeamWebRtcRequestError) &&
    error.message === sourceText("error.remote.channelNotOpen")
  );
}

function isEndedSessionError(error: unknown): boolean {
  return error instanceof Error && "status" in error && (error.status === 403 || error.status === 404);
}
