import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { basename } from "node:path";
import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { type InviteLinkOptions, type InviteLinkPayload, parseInviteUrl } from "@openbot/contracts/invite-links";
import type {
  AgentEvent,
  AgentImportPreview,
  AgentSummary,
  AvatarImageInput,
  ConversationPage,
  ConversationPageAnchor,
  ConversationReadState,
  ConversationSearchPage,
  ConversationWithReadState,
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingInput,
  DirectTypingRealtimeEvent,
  DraftAttachment,
  DuplicateAgentResult,
  HostedServerIssue,
  InvitePreview,
  InviteSummary,
  JoinServerInput,
  LoginServerInput,
  MarkConversationReadInput,
  MarkDirectReadInput,
  RemoteDesktopSession,
  SendDirectMessageInput,
  ServerNotificationLevel,
  ServerSummary,
  SetTeamTypingInput,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamRealtimeEvent,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import {
  decodeRemoteAgentImportPreview,
  LOCAL_SERVER_ID,
  REMOTE_DESKTOP_SETUP_CAPABILITY,
  type RemoteDesktopTestInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import { decodeBrowserViewSessionResponse } from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_MEMBER_LEAVE_CAPABILITY, type TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import type { HostRestartEvent } from "@openbot/contracts/team-protocol/host-update-v1";
import { decodeTeamProtocolV1CurrentHttpResponse } from "@openbot/contracts/team-protocol/v1-adapter";
import { sourceText } from "@openbot/i18n/source";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { Deferred, Effect, Exit, Layer, Result, Scope, Semaphore } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";
import { contentDispositionFileName } from "./content-disposition";
import type { HostedServerDesktopService } from "./hosted-server-service";
import { decodeAgentSummary, decodeDraftAttachment, decodeDuplicateAgentResultFromHost } from "./remote-agent-decoding";
import { type RemoteAttachment, RemoteAttachmentCache } from "./remote-attachment-cache";
import type { RemoteConnectTrace } from "./remote-connect-trace";
import {
  decodeConversationPageFromHost,
  decodeConversationReadState,
  decodeConversationReadStates,
  decodeConversationSearchPageFromHost,
  decodeConversationWithReadState,
  decodeDirectConversationPage,
  decodeDirectConversationReadState,
  decodeDirectConversationSnapshot,
  decodeDirectMessage,
  decodeDirectThreadSummaries,
} from "./remote-conversation-decoding";
import { decodeRemoteDesktopSetupFromHost, decodeRemoteDesktopTestFromHost } from "./remote-desktop-setup-decoding";
import { decodeRemoteDesktopSession } from "./remote-device-decoding";
import { decodeVoid, type ResponseDecoder } from "./remote-host-decoding";
import { type RemoteRequestInit, RemoteServerClient } from "./remote-server-client";
import { RemoteServerConnections } from "./remote-server-connections";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { RemoteEventRefresh } from "./remote-server-event-refresh";
import { RemoteEventStream } from "./remote-server-event-stream";
import { reconcileWebRtcHosts } from "./remote-server-host-directory";
import { requestJson } from "./remote-server-http";
import { RemotePresenceCache } from "./remote-server-presence";
import { RemoteServerStore, type TokenCipher } from "./remote-server-store";
import type { StoredRemoteServer } from "./remote-server-stored-shape";
import { remoteServerSummaries } from "./remote-server-summaries";
import { addRemotePreviewUrls, isLocalDevelopmentApi, pageQuery } from "./remote-server-urls";
import {
  RemoteRequest,
  RemoteWorkflowError,
  remoteCall,
  remoteDecode,
  toRemoteWorkflowError,
} from "./remote-service-effects";
import { decodeInvitePreview, decodeJoinResult, decodeTeamPresenceSnapshot } from "./remote-team-decoding";
import { RemoteTeamDirectory } from "./remote-team-directory";
import { RemoteViewerProxy } from "./remote-viewer-proxy";
import { fingerprint } from "./team-store";
import {
  TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS,
  type TeamWebRtcClientTransport,
} from "./team-webrtc-client-transport";

interface RemoteServerEvents {
  directoryInvalidated: [];
  changed: [servers: ServerSummary[]];
  agent: [serverId: string, event: AgentEvent, bufferedLive?: boolean];
  presence: [serverId: string, snapshot: TeamPresenceSnapshot];
  directMessage: [serverId: string, event: DirectMessageRealtimeEvent];
  directTyping: [serverId: string, event: DirectTypingRealtimeEvent];
}

interface CentralAccountSession {
  createTeamAuthTicket: (serverId: string) => Effect.Effect<string, CentralAuthOperationError>;
  getEmail: () => string;
  sendTeamInviteEmail?: (input: {
    email: string;
    serverName: string;
    inviteUrl: string;
    role: "admin" | "member";
  }) => Effect.Effect<void, CentralAuthOperationError>;
}

interface RemoteServerManagerOptions {
  allowLocalDevelopmentInvites?: boolean;
  /** The origin of the self-hosted account service that this app is configured to use. */
  selfHostedApiOrigin?: string | undefined;
  appVersion?: string;
  webrtcTransport?: TeamWebRtcClientTransport;
  getLocalHostId?: () => string | null;
  /** The account service's hosted servers. Each joined host can be one. */
  hostedServers?: HostedServerWakeHooks;
  /** Times each WebRTC connection for the local trace. */
  connectTrace?: RemoteConnectTrace;
  /**
   * The account's first load. The host list needs only the saved token, so it can arrive before the
   * account says who is signed in; the first read of it waits for this.
   */
  accountReady?: Effect.Effect<unknown, RemoteWorkflowError>;
}

export interface HostedServerWakeHooks {
  /**
   * Signal answered that the host is not connected. Tells whether it is a hosted server that sleeps, and
   * starts a stopped server that does not sleep when `wake` is true.
   */
  unavailable: OmitThisParameter<HostedServerDesktopService["unavailableHost"]>;
  /** The user's input starts a sleeping server. */
  wake: OmitThisParameter<HostedServerDesktopService["wake"]>;
}

export interface DevelopmentRemoteServerConnection {
  serverId: string;
  serverName: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
  username: string;
  sessionToken: string;
}

const REMOTE_DUPLICATION_TIMEOUT_MS = TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS;
/** An export of up to 100 MB goes up and is read in one request, and apply creates many agents. */
export const AGENT_IMPORT_UPLOAD_TIMEOUT_MS = TEAM_WEBRTC_REMOTE_REQUEST_TIMEOUT_MILLISECONDS;
// How long a host that restarts into an update keeps the fast retry after Signal first misses it. A
// host that is not back by then is offline, as any other host.
const HOST_RESTART_RETRY_MS = 10 * 60_000;
// How long a hosted server keeps the short retry after a wake request. It boots in about a minute; a
// server that is not back by then is asked about again.
const HOSTED_SERVER_START_MS = 5 * 60_000;
export class RemoteServerManager extends EventEmitter<RemoteServerEvents> {
  readonly #scope = Scope.makeUnsafe();
  readonly #platform: Layer.Layer<RemoteRequest>;
  #stopped = false;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #store: RemoteServerStore;
  readonly #connections: RemoteServerConnections;
  readonly #client: RemoteServerClient;
  readonly #refresh: RemoteEventRefresh;
  readonly #events: RemoteEventStream;
  readonly #presence: RemotePresenceCache;
  readonly #attachments = new RemoteAttachmentCache();
  readonly #team: RemoteTeamDirectory;
  readonly #centralAccount: CentralAccountSession;
  readonly #allowLocalDevelopmentInvites: boolean;
  readonly #inviteLinks: InviteLinkOptions;
  readonly #appVersion: string | null;
  #duplicateOperationIds = new Map<string, string>();
  /** When Signal first missed each host that restarts into an update. */
  readonly #hostRestartAway = new Map<string, number>();
  readonly #webrtcTransport: TeamWebRtcClientTransport | null;
  readonly #getLocalHostId: () => string | null;
  /** From the last host list. Null before one, or when this computer hosts nothing that the account lists. */
  #localMemberLimit: number | null = null;
  readonly #hostedServers: HostedServerWakeHooks | null;
  /** When each hosted server that starts after a wake request started. */
  readonly #hostedStartAt = new Map<string, number>();
  readonly #hostedWakePending = new Set<string>();
  readonly #hostedStartRevision = new Map<string, number>();
  readonly #hostedStartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Hosted servers that did not come online in the start time. Only the user's next wake starts them again. */
  readonly #hostedStartExpired = new Set<string>();
  #appFocused = true;
  readonly #remoteViewerProxy: RemoteViewerProxy | null;
  #selections = Semaphore.makeUnsafe(1);
  /** One read of the account's host list at a time, so an older answer cannot replace a newer one. */
  readonly #directorySync = Semaphore.makeUnsafe(1);
  /** Done when the first read of the account's host list after `initialize` ends, either way. */
  readonly #initialDirectory = Deferred.makeUnsafe<void>();
  readonly #connectTrace: RemoteConnectTrace | null;
  readonly #accountReady: Effect.Effect<unknown, RemoteWorkflowError>;
  #muteExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    path: string,
    cipher: TokenCipher,
    centralAccount: CentralAccountSession,
    options: RemoteServerManagerOptions = {},
  ) {
    super();
    this.#store = new RemoteServerStore({ path, cipher });
    this.#appVersion = options.appVersion ?? null;
    this.#connections = new RemoteServerConnections({
      appVersion: this.#appVersion,
      onChanged: () => this.#emitChanged(),
      // The registry never names the event stream. It reports that reconnecting is pointless and the
      // manager decides what that costs -- which is what keeps the socket out of the error path.
      onReconnectSuspended: (serverId) => this.#suspendServer(serverId),
    });
    this.#centralAccount = centralAccount;
    this.#allowLocalDevelopmentInvites = options.allowLocalDevelopmentInvites ?? false;
    this.#inviteLinks = {
      allowLocalDevelopmentApiUrl: this.#allowLocalDevelopmentInvites,
      selfHostedApiOrigin: options.selfHostedApiOrigin,
    };
    this.#webrtcTransport = options.webrtcTransport ?? null;
    this.#getLocalHostId = options.getLocalHostId ?? (() => null);
    this.#hostedServers = options.hostedServers ?? null;
    this.#connectTrace = options.connectTrace ?? null;
    this.#accountReady = options.accountReady ?? Effect.void;
    this.#client = new RemoteServerClient({
      appVersion: this.#appVersion,
      servers: this.#store,
      connections: this.#connections,
      transport: this.#webrtcTransport,
    });
    this.#platform = Layer.succeed(
      RemoteRequest,
      RemoteRequest.of({
        request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
      }),
    );
    this.#refresh = new RemoteEventRefresh({
      request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
      hasServer: (serverId) => this.#store.has(serverId),
      emit: (serverId, event, bufferedLive) =>
        bufferedLive ? this.emit("agent", serverId, event, true) : this.emit("agent", serverId, event),
    });
    this.#presence = new RemotePresenceCache({
      fetchSnapshot: (serverId) => this.request(serverId, TEAM_API_ROUTES.team.presence, decodeTeamPresenceSnapshot),
      onSnapshot: (serverId, snapshot) => this.emit("presence", serverId, snapshot),
    });
    this.#team = new RemoteTeamDirectory({
      servers: this.#store,
      request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
      transport: this.#webrtcTransport,
      sendInviteEmail: (input) => {
        if (!this.#centralAccount.sendTeamInviteEmail)
          throw new Error(sourceText("error.remote.emailDeliveryUnavailable"));
        return this.#centralAccount.sendTeamInviteEmail(input);
      },
    });
    this.#events = new RemoteEventStream({
      appVersion: this.#appVersion,
      servers: this.#store,
      client: this.#client,
      connections: this.#connections,
      agents: this.#refresh,
      transport: this.#webrtcTransport,
      // The stream reports facts and this is where they become state: an identity is written, a
      // presence snapshot is cached, and the rest are forwarded to the renderer.
      onServerIdentity: (serverId, identity) => this.#applyServerIdentity(serverId, identity),
      onPresence: (serverId, snapshot) => this.#presence.accept(serverId, snapshot),
      onDirectMessage: (serverId, event) => this.emit("directMessage", serverId, event),
      onDirectTyping: (serverId, event) => this.emit("directTyping", serverId, event),
      onHostRestart: (serverId, event) => this.#applyHostRestart(serverId, event),
      onOffline: (serverId) => this.#presence.markOffline(serverId),
      onChanged: () => this.#emitChanged(),
    });
    this.#remoteViewerProxy = this.#webrtcTransport
      ? new RemoteViewerProxy({
          transport: this.#webrtcTransport,
          fetchResource: (serverId, path, init) => this.fetchRemoteViewerResource(serverId, path, init),
        })
      : null;
    this.#webrtcTransport?.on("connected", (serverId) => {
      this.#events.clearReconnectBackoff(serverId);
      this.#hostRestartAway.delete(serverId);
      this.#clearHostedStart(serverId);
      this.#hostedStartExpired.delete(serverId);
      this.#connections.markConnected(serverId);
      this.#emitChanged();
      const server = this.#store.find(serverId);
      this.#background(
        this.#owned(
          Effect.gen({ self: this }, function* () {
            // Read the host report before negotiating the fixed WebRTC transport. This keeps the
            // transport view stable when both operations finish in the same event-loop turn.
            yield* this.#client.refreshWebRtcCompatibility(serverId).pipe(Effect.catch(() => Effect.void));
            if (server) yield* this.#client.ensureCompatibility(server, true).pipe(Effect.catch(() => Effect.void));
            this.#connectTrace?.mark(serverId, "compatibility");
            this.#emitChanged();
            yield* Effect.all(
              [
                this.#refresh.refreshAgentRoster(serverId).pipe(
                  Effect.result,
                  Effect.map((result) =>
                    this.#connectTrace?.mark(serverId, "first-request", Result.isSuccess(result) ? "ok" : "error"),
                  ),
                ),
                server
                  ? Effect.gen({ self: this }, function* () {
                      const remoteDesktopAvailable = yield* this.#client
                        .probeRemoteDesktop(server)
                        .pipe(Effect.catch(() => Effect.succeed(false)));
                      yield* this.#store.update(serverId, { remoteDesktopAvailable });
                      this.#emitChanged();
                    }).pipe(Effect.catch(() => Effect.void))
                  : Effect.void,
              ],
              { concurrency: "unbounded" },
            );
          }),
        ),
      );
    });
    this.#webrtcTransport?.on("disconnected", (serverId) => {
      const wasOnline = this.#connections.statusFor(serverId).state === "online";
      // A host the app has stopped reconnecting to is not merely offline. The recorded failure is
      // the reason it will not come back, and this disconnect is that failure's own tail -- the one
      // `#suspendServer` asked for. Writing "offline" over an "incompatible" would leave the issue
      // sitting behind an ordinary word for it, which is why the HTTPS arm guards the same way.
      if (!this.#events.isReconnectSuspended(serverId)) this.#connections.setState(serverId, "offline");
      this.#presence.markOffline(serverId);
      this.#emitChanged();
      this.#events.scheduleReconnect(serverId);
      if (wasOnline) this.emit("directoryInvalidated");
    });
    this.#webrtcTransport?.on("event", (serverId, event) => this.#handleWebRtcEvent(serverId, event));
    this.#webrtcTransport?.on("error", (serverId, code, message) => {
      // Each failure checks the start time, so a start that fails for another reason also ends.
      const hostedStarting = this.#awaitsHostedStart(serverId);
      if (code === "host_unavailable" && !this.#awaitsHostRestart(serverId) && !hostedStarting) {
        this.#events.markHostOffline(serverId);
        // A hosted server that another reason stopped starts again only for the selected server with the
        // app in focus. A server that sleeps waits for the user's input.
        Effect.runFork(
          this.#checkHostedServer(
            serverId,
            !this.#hostedStartExpired.has(serverId) && this.#appFocused && serverId === this.#store.activeServerId,
          ),
        );
      }
      if (!this.#connections.reportTransportError(serverId, code, message)) this.#events.scheduleReconnect(serverId);
      if (code === "session_revoked") this.emit("directoryInvalidated");
    });
  }

  /**
   * What "reconnecting is pointless" costs. Suspending the event stream ends an HTTPS server's
   * socket with it, but a WebRTC host has no socket there: its events arrive on a data channel the
   * transport owns, so without this it keeps pushing them from a host the app has just decided it
   * cannot understand. The suspension is recorded first, so the `disconnected` event this raises
   * finds the pause already in place and does not schedule a reconnect around it.
   */
  /**
   * A self-hosted account service gets the token of each invitation that this app previews or
   * accepts, so it must not see the token of an invitation for another service.
   */
  #parseInvite(inviteUrl: string): InviteLinkPayload {
    const invite = parseInviteUrl(inviteUrl, this.#inviteLinks);
    const service = this.#inviteLinks.selfHostedApiOrigin;
    if (service && new URL(invite.apiUrl).origin !== service) {
      throw new Error(sourceText("error.remote.inviteOtherService"));
    }
    return invite;
  }

  #suspendServer(serverId: string): void {
    this.#events.suspendReconnect(serverId);
    if (this.#store.find(serverId)?.transport !== "webrtc-v2") return;
    const transport = this.#webrtcTransport;
    if (transport) this.#background(this.#owned(transport.disconnect(serverId).pipe(Effect.catch(() => Effect.void))));
  }

  /**
   * Starts work for a transport callback in this manager's scope, now, so events keep their order.
   * `stop` interrupts it. A failure is dropped: the callback has nobody to answer.
   */
  #background(operation: Effect.Effect<unknown, RemoteWorkflowError>): void {
    Effect.runFork(
      Effect.forkIn(operation.pipe(Effect.catch(() => Effect.void)), this.#scope, { startImmediately: true }),
    );
  }

  #owned<A>(operation: Effect.Effect<A, RemoteWorkflowError, RemoteRequest>): Effect.Effect<A, RemoteWorkflowError> {
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

  /**
   * Loads the stored servers. The read of the account's host list goes on in the background, so the
   * window does not wait for the account service: `awaitHostDirectory` waits for it. A stored host
   * keeps the key it pinned before, and the directory never replaces a pinned key, so that key is
   * pinned now. A host without one waits in the transport until the directory pins it.
   */
  readonly initialize = Effect.fn("RemoteManager.initialize")(
    function* (this: RemoteServerManager): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      yield* this.#store.load();
      this.#scheduleMuteExpiry();
      this.#initializeConnectionStates();
      if (!transport) {
        Deferred.doneUnsafe(this.#initialDirectory, Effect.void);
        return;
      }
      for (const server of this.#store.servers) {
        if (server.transport === "webrtc-v2" && server.publicKey) transport.pinHostKey(server.id, server.publicKey);
      }
      transport.beginHostKeySync();
      const startedAt = performance.now();
      this.#background(
        this.#owned(
          this.#accountReady.pipe(
            Effect.andThen(this.#syncWebRtcHosts()),
            Effect.tap(() => Effect.sync(() => this.#initializeConnectionStates())),
            // A host the directory added after the event connections started has no connection yet.
            Effect.tap(() => (this.#events.enabled ? this.startEventConnections() : Effect.void)),
            Effect.tap(() => Effect.sync(() => this.#emitChanged())),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                this.#connectTrace?.directory(performance.now() - startedAt, Exit.isSuccess(exit) ? "ok" : "error");
                transport.endHostKeySync();
                Deferred.doneUnsafe(this.#initialDirectory, Effect.void);
              }),
            ),
          ),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** Waits for the first read of the account's host list. It ends also when the read fails. */
  readonly awaitHostDirectory = Effect.fn("RemoteManager.awaitHostDirectory")(function* (this: RemoteServerManager) {
    yield* Deferred.await(this.#initialDirectory);
  }).bind(this);

  /**
   * Starts the connection to the selected WebRTC server before the window loads. The other servers
   * start with the event connections, after the window loads. A failure is dropped here: the event
   * connections try again and report it.
   */
  connectActiveServer(): void {
    const transport = this.#webrtcTransport;
    const server = this.#store.find(this.#store.activeServerId);
    if (!transport || server?.transport !== "webrtc-v2") return;
    this.#background(this.#owned(transport.connect(server.id)));
  }

  /** A server that has no connection state yet starts offline, with its compatibility unknown. */
  #initializeConnectionStates(): void {
    for (const server of this.#store.servers) {
      if (this.#connections.stateFor(server.id) !== null) continue;
      this.#connections.setState(server.id, "offline");
      if (server.transport === "webrtc-v2") this.#connections.startCheckingCompatibility(server.id);
    }
  }

  list(): ServerSummary[] {
    return remoteServerSummaries(
      this.#store.servers,
      this.#store.activeServerId,
      (serverId) => this.#connections.statusFor(serverId),
      this.#localMemberLimit,
    ).map((server) => {
      const mute = this.#store.muteState(server.id);
      return {
        ...server,
        notificationsMuted: mute.muted,
        notificationsMutedUntil: mute.mutedUntil,
        notificationLevel: this.#store.notificationLevel(server.id),
      };
    });
  }

  /**
   * The account service says this user's server list changed, and it reached this computer through
   * Signal rather than through a poll. The refresh itself belongs to the caller that owns the
   * account check, so this only says the stored list can no longer be trusted.
   */
  readonly invalidateDirectory = Effect.fn("RemoteManager.invalidateDirectory")(function* (this: RemoteServerManager) {
    yield* this.#events.retryOfflineHosts();
    this.emit("directoryInvalidated");
  }).bind(this);

  /** Focus retries an offline host at once. After that, it retries each 5 minutes with focus and each 15 without. */
  readonly setAppFocused = Effect.fn("RemoteManager.setAppFocused")(function* (
    this: RemoteServerManager,
    focused: boolean,
  ) {
    this.#appFocused = focused;
    yield* this.#events.setAppFocused(focused);
  }).bind(this);

  /** The computer woke from sleep. Each host reconnects at once instead of after its backoff. */
  readonly wake = Effect.fn("RemoteManager.wake")(function* (this: RemoteServerManager) {
    yield* this.#events.wake();
  }).bind(this);

  /** A file on this server was deleted, so a copy of it must not be shown again. */
  forgetCachedAttachments(serverId: string): void {
    this.#attachments.forget(serverId);
  }

  readonly syncRemoteHosts = Effect.fn("RemoteManager.syncRemoteHosts")(
    function* (this: RemoteServerManager): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      yield* this.#syncWebRtcHosts();
      if (this.#events.enabled) yield* this.startEventConnections();
      this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  get activeServerId(): string {
    return this.#store.activeServerId;
  }

  // What the host on the other end negotiated it can do. An IPC handler asks before calling a route
  // an older host does not serve, so this answers false until compatibility is known rather than
  // waiting for it -- a capability nobody has confirmed is one you cannot use yet.
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean {
    return this.#connections.compatibilityFor(serverId)?.capabilities.includes(capability) ?? false;
  }

  readonly startEventConnections = Effect.fn("RemoteManager.startEventConnections")(function* (
    this: RemoteServerManager,
  ) {
    yield* this.#events.start();
  }).bind(this);

  readonly refreshRuntimeSnapshots = Effect.fn("RemoteManager.refreshRuntimeSnapshots")(function* (
    this: RemoteServerManager,
  ) {
    yield* this.#events.refreshRuntimeSnapshots();
  }).bind(this);

  select(serverId: string): Effect.Effect<ServerSummary[], RemoteWorkflowError> {
    return this.#owned(this.#selections.withPermit(Effect.uninterruptible(this.#selectEffect(serverId))));
  }

  readonly #selectEffect = Effect.fn("RemoteManager.select")(function* (this: RemoteServerManager, serverId: string) {
    if (serverId !== LOCAL_SERVER_ID && !this.#store.has(serverId))
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
    const previousSelection = this.#store.selection;
    const selectionRevision = this.#store.setActiveServerId(serverId);
    this.#events.syncScopes();
    yield* this.#store.persist().pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (this.#store.activeServerRevision === selectionRevision) {
            this.#store.restoreSelection(previousSelection);
            this.#events.syncScopes();
          }
        }),
      ),
    );
    this.#emitChanged();
    yield* this.startEventConnections();
    if (this.#connections.hostedSleepFor(serverId) === "sleeping") yield* this.#wakeHostedServer(serverId);
    else if (this.#events.isHostOffline(serverId)) yield* this.#checkHostedServer(serverId, true);
    return this.list();
  });

  // No duration mutes until the user unmutes.

  readonly setMuted = Effect.fn("RemoteManager.setMuted")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      muted: boolean,
      durationMs?: number,
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      yield* this.#store.setMuted(serverId, muted, durationMs === undefined ? null : Date.now() + durationMs);
      this.#scheduleMuteExpiry();
      this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly setNotificationLevel = Effect.fn("RemoteManager.setNotificationLevel")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      level: ServerNotificationLevel,
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      yield* this.#store.setNotificationLevel(serverId, level);
      this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  // The rail shows a muted server until its timed mute ends, so the end has to reach the renderer as a
  // change. One timer covers the earliest end; each run schedules the next one.
  #scheduleMuteExpiry(): void {
    if (this.#muteExpiryTimer) clearTimeout(this.#muteExpiryTimer);
    this.#muteExpiryTimer = null;
    const expiry = this.#store.nextMuteExpiry();
    if (expiry === null) return;
    // setTimeout overflows above 2^31-1 ms; a later run reschedules until the end is reached.
    const delay = Math.min(Math.max(expiry - Date.now(), 0) + 1, 2_147_483_647);
    this.#muteExpiryTimer = setTimeout(() => {
      this.#scheduleMuteExpiry();
      this.#emitChanged();
    }, delay);
    this.#muteExpiryTimer.unref?.();
  }

  readonly reorder = Effect.fn("RemoteManager.reorder")(
    function* (
      this: RemoteServerManager,
      serverIds: string[],
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      if (yield* this.#store.reorder(serverIds)) this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly join = Effect.fn("RemoteManager.join")(
    function* (
      this: RemoteServerManager,
      input: JoinServerInput,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      const invite = yield* remoteDecode(() => this.#parseInvite(input.inviteUrl));
      if (transport && !isLocalDevelopmentApi(invite.apiUrl)) {
        const preview = yield* transport.previewInvite(invite.token);
        if (preview.hostId !== invite.serverId)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.inviteHostMismatch")) });
        const publicKey = preview.devicePublicKey;
        if (!publicKey || (yield* remoteDecode(() => fingerprint(publicKey))) !== invite.fingerprint) {
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.inviteIdentityMismatch")),
          });
        }
        const accepted = yield* transport.acceptInvite(invite.token);
        if (accepted.hostId !== invite.serverId)
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.inviteAcceptedOtherHost")),
          });
        yield* this.#store.unhideHost(accepted.hostId);
        yield* this.#syncWebRtcHosts();
        const synchronized = this.#store.find(accepted.hostId);
        if (!synchronized || synchronized.fingerprint !== invite.fingerprint) {
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.inviteIdentityChanged")),
          });
        }
        // The identity checked out, so an entry for this host that this build could not read is now
        // superseded. `#syncWebRtcHosts` above deliberately kept it -- reconciliation is not a join.
        yield* this.#store.retireUnreadable(accepted.hostId);
        this.#store.setActiveServerId(accepted.hostId);
        this.#connections.setState(accepted.hostId, "connecting");
        yield* this.#store.persist();
        yield* transport.connect(accepted.hostId);
        this.#emitChanged();
        return yield* remoteDecode(() => requiredServerSummary(this.list(), accepted.hostId));
      }
      const verifiedIdentity = yield* this.#client.verifyIdentity(invite.apiUrl, invite.serverId, invite.fingerprint);
      const accountTicket = yield* this.#centralAccount
        .createTeamAuthTicket(invite.serverId)
        .pipe(toRemoteWorkflowError);
      const result = yield* requestJson(invite.apiUrl, TEAM_API_ROUTES.join.account, decodeJoinResult, {
        method: "POST",
        body: {
          inviteToken: invite.token,
          accountTicket,
        },
        ...this.#client.requestProtocol(verifiedIdentity.compatibility),
      }).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
      const stored: StoredRemoteServer = {
        id: invite.serverId,
        name: verifiedIdentity.serverName,
        apiUrl: invite.apiUrl,
        fingerprint: invite.fingerprint,
        publicKey: verifiedIdentity.publicKey,
        username: this.#centralAccount.getEmail().trim().toLowerCase(),
        encryptedToken: yield* remoteDecode(() => this.#store.sealToken(result.sessionToken)),
        remoteDesktopAvailable: false,
        logoVersion: verifiedIdentity.logoVersion,
        role: result.member.role,
      };
      this.#connections.setCompatibility(stored.id, verifiedIdentity.compatibility);
      this.#connections.clearIssue(stored.id);
      this.#connections.setState(stored.id, "online");
      // Probed before the server is stored, not after: a probe that fails outright now leaves the list
      // as it was, instead of an entry that is in memory but was never written.
      stored.remoteDesktopAvailable = yield* this.#client.probeRemoteDesktop(stored);
      yield* this.#store.adopt(stored);
      this.#events.syncScopes();
      this.#emitChanged();
      yield* this.#events.restart(stored.id, true);
      return yield* remoteDecode(() => requiredServerSummary(this.list(), stored.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly connectDevelopmentServer = Effect.fn("RemoteManager.connectDevelopmentServer")(
    function* (
      this: RemoteServerManager,
      input: DevelopmentRemoteServerConnection,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      // A published dev host answers over WebRTC, and that membership belongs to an account the
      // control plane keeps across restarts. The technical member this connection carries does not:
      // publishing reconciles it away, so adopting an HTTP entry over the WebRTC one -- same host, so
      // same id -- would replace a working server with one the host answers 401 to. The host role
      // writes the file either way; which of the two connections wins is decided here.
      const adopted = this.#store.find(input.serverId);
      if (adopted?.transport === "webrtc-v2")
        return yield* remoteDecode(() => requiredServerSummary(this.list(), input.serverId));
      const verifiedIdentity = yield* this.#client.verifyIdentity(input.apiUrl, input.serverId, input.fingerprint);
      if (verifiedIdentity.publicKey !== input.publicKey || verifiedIdentity.serverName !== input.serverName) {
        return yield* new RemoteWorkflowError({ cause: new Error("The local development server identity changed.") });
      }
      const stored: StoredRemoteServer = {
        id: input.serverId,
        name: input.serverName,
        apiUrl: input.apiUrl,
        fingerprint: input.fingerprint,
        publicKey: input.publicKey,
        username: input.username,
        encryptedToken: yield* remoteDecode(() => this.#store.sealToken(input.sessionToken)),
        remoteDesktopAvailable: false,
        logoVersion: verifiedIdentity.logoVersion,
        role: "member",
      };
      this.#connections.setCompatibility(stored.id, verifiedIdentity.compatibility);
      this.#connections.clearIssue(stored.id);
      this.#connections.setState(stored.id, "online");
      // Probed before the server is stored, not after: a probe that fails outright now leaves the list
      // as it was, instead of an entry that is in memory but was never written.
      stored.remoteDesktopAvailable = yield* this.#client.probeRemoteDesktop(stored);
      yield* this.#store.adopt(stored);
      this.#events.syncScopes();
      this.#emitChanged();
      yield* this.#events.restart(stored.id, true);
      return yield* remoteDecode(() => requiredServerSummary(this.list(), stored.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly previewInvite = Effect.fn("RemoteManager.previewInvite")(
    function* (
      this: RemoteServerManager,
      input: JoinServerInput,
    ): Effect.fn.Return<InvitePreview, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      const invite = yield* remoteDecode(() => this.#parseInvite(input.inviteUrl));
      if (transport && !isLocalDevelopmentApi(invite.apiUrl)) {
        const preview = yield* transport.previewInvite(invite.token);
        if (preview.hostId !== invite.serverId)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.inviteHostMismatch")) });
        const publicKey = preview.devicePublicKey;
        if (!publicKey || (yield* remoteDecode(() => fingerprint(publicKey))) !== invite.fingerprint) {
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.inviteIdentityMismatch")),
          });
        }
        return {
          serverId: preview.hostId,
          serverName: preview.hostName,
          apiHostname: new URL(invite.apiUrl).hostname,
          role: preview.role,
          expiresAt: new Date(preview.expiresAt).toISOString(),
          emailBound: preview.emailBound,
          permanent: preview.permanent,
        };
      }
      const identity = yield* this.#client.verifyIdentity(invite.apiUrl, invite.serverId, invite.fingerprint);
      const preview = yield* requestJson(invite.apiUrl, TEAM_API_ROUTES.join.invitationPreview, decodeInvitePreview, {
        method: "POST",
        body: { inviteToken: invite.token },
        ...this.#client.requestProtocol(identity.compatibility),
      }).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
      return {
        serverId: invite.serverId,
        serverName: identity.serverName,
        apiHostname: new URL(invite.apiUrl).hostname,
        ...preview,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly login = Effect.fn("RemoteManager.login")(
    function* (
      this: RemoteServerManager,
      input: LoginServerInput,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(input.serverId));
      this.#connections.setState(server.id, "connecting");
      this.#emitChanged();
      const attempt0 = yield* Effect.gen({ self: this }, function* () {
        const identity = yield* this.#client.verifyIdentity(server.apiUrl, server.id, server.fingerprint);
        const accountTicket = yield* this.#centralAccount.createTeamAuthTicket(server.id).pipe(toRemoteWorkflowError);
        const result = yield* requestJson(server.apiUrl, TEAM_API_ROUTES.auth.account, decodeJoinResult, {
          method: "POST",
          body: { accountTicket },
          ...this.#client.requestProtocol(identity.compatibility),
        }).pipe(
          Effect.mapError(
            (failure) =>
              new RemoteWorkflowError({
                cause:
                  failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                    ? failure
                    : failure.cause,
              }),
          ),
        );
        this.#connections.setCompatibility(server.id, identity.compatibility);
        this.#connections.clearIssue(server.id);
        const signedIn = yield* this.#store.update(server.id, {
          username: this.#centralAccount.getEmail().trim().toLowerCase(),
          role: result.member.role,
          encryptedToken: yield* remoteDecode(() => this.#store.sealToken(result.sessionToken)),
          name: identity.serverName,
          logoVersion: identity.logoVersion,
        });
        this.#connections.setState(server.id, "online");
        // The stream restarts before the probe, not after. `restart(id, true)` lifts the suspension a
        // previous failure left, and opening the socket clears the recorded issue -- so with the probe
        // first, a host answering the capabilities route with something no build can read had its
        // protocol failure wiped by the restart that followed it, and the sign-in ended online. Last
        // writer wins, so the probe has to be the last writer.
        yield* this.#events.restart(server.id, true);
        // The probe authenticates with the session token this sign-in just replaced, so it has to run
        // against the stored server rather than the one `login` was handed. It is also the one step
        // here that may not fail the sign-in: the credentials are already on disk and the user is
        // signed in, so letting a screen-sharing probe reject `login` would report a failure that did
        // not happen and leave the server in `error` with a working token. The flag keeps its previous
        // value and `#refreshRemoteDesktop` corrects it later.
        if (signedIn) {
          // Best effort in both halves. The probe may not reject the sign-in, and neither may writing
          // its answer: the session token is already on disk, so a failure here would report a
          // sign-in that did not fail and leave the server in `error` with working credentials. A
          // probe that rejects leaves the flag untouched; a write that fails leaves the new flag in
          // memory and off disk, which is what every store mutation does and is the direction that
          // keeps the token this sign-in just minted usable.
          yield* this.#client.probeRemoteDesktop(signedIn).pipe(
            Effect.flatMap((remoteDesktopAvailable) => this.#store.update(server.id, { remoteDesktopAvailable })),
            Effect.catch(() => Effect.void),
          );
        }
      }).pipe(Effect.result);
      if (Result.isFailure(attempt0)) {
        const error = attempt0.failure.cause;
        this.#connections.reportError(server.id, error, "error");
        return yield* new RemoteWorkflowError({ cause: error });
      }
      this.#emitChanged();
      return yield* remoteDecode(() => requiredServerSummary(this.list(), server.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly retryConnection = Effect.fn("RemoteManager.retryConnection")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (
        this.#connections.hostedSleepFor(serverId) === "sleeping" ||
        this.#connections.statusFor(serverId).hostedIssue
      ) {
        this.#clearHostedStart(serverId);
        this.#hostedStartExpired.delete(serverId);
        yield* this.#wakeHostedServer(serverId);
      }
      const blockedState = this.#connections.hasIssue(serverId)
        ? (this.#connections.stateFor(serverId) ?? "error")
        : "error";
      const attempt1 = yield* Effect.gen({ self: this }, function* () {
        if (server.transport === "webrtc-v2") {
          if (!transport)
            return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.webRtcUnavailable")) });
          // The user retrying is what lifts the suspension a protocol or credential failure left
          // behind. Without this the connection comes up and the next disconnect never reconnects,
          // because `scheduleReconnect` still sees the host paused -- the HTTPS arm below gets the
          // same reset from `restart(serverId, true)`.
          this.#events.resumeReconnect(serverId);
          this.#connections.setState(serverId, "connecting");
          this.#emitChanged();
          yield* transport.connect(serverId);
          // The `connected` handler is what turns that "connecting" back into "online", and a host
          // that was already connected raises no such event -- the session it would announce is the
          // one still running. Retrying a host whose channel had never actually dropped therefore
          // left it reading as reconnecting until it next went offline for real.
          if (this.#connections.stateFor(serverId) === "connecting" && transport.isConnected(serverId)) {
            // The same session continues, so the host does not send its restart state again.
            const hostRestart = this.#connections.hostRestartFor(serverId);
            this.#connections.markConnected(serverId);
            this.#connections.setHostRestart(serverId, hostRestart);
            this.#emitChanged();
          }
          return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
        }
        this.#connections.setState(serverId, "connecting");
        this.#emitChanged();
        yield* this.#client.ensureCompatibility(server, true);
        yield* this.#events.restart(serverId, true);
      }).pipe(Effect.result);
      if (Result.isFailure(attempt1)) {
        const error = attempt1.failure.cause;
        this.#connections.reportError(serverId, error, blockedState);
        // A failed check can leave the old event socket open. Replace it so a later
        // successful connection can restore the state, with the existing backoff.
        if (!this.#events.isReconnectSuspended(serverId)) yield* this.#events.restart(serverId);
        return yield* new RemoteWorkflowError({ cause: error });
      } else if (attempt1.success !== undefined) return attempt1.success;
      return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly remove = Effect.fn("RemoteManager.remove")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      if (serverId === LOCAL_SERVER_ID)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.localServerRemove")) });
      const server = this.#store.find(serverId);
      if (server?.transport === "webrtc-v2") {
        if (!transport)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.webRtcUnavailable")) });
        // An owner cannot leave their own host. The owner removes it from the account service, so the
        // next directory sync on each device of each member does not list it again.
        if (server.role === "owner") yield* transport.removeOwnedHost(serverId);
        else yield* transport.leaveHost(serverId);
        yield* transport.disconnect(serverId).pipe(Effect.catch(() => Effect.void));
      } else if (server && this.#connections.compatibilityFor(serverId)?.negotiatedProtocol) {
        // An HTTP host with `member-leave-v1` removes the membership as an admin removal does. An
        // older host has no such route, so logging out is the most it can do: this computer's token
        // stops working, and the membership stays for an admin to remove. Only a host that has already
        // answered the negotiation is asked, so leaving never waits for one still being negotiated,
        // and a failure is ignored, as the WebRTC disconnect is: a host that is gone for good must not
        // keep the server in the list.
        const path = this.supportsCapability(serverId, TEAM_MEMBER_LEAVE_CAPABILITY)
          ? TEAM_API_ROUTES.team.leave
          : TEAM_API_ROUTES.auth.logout;
        yield* this.request(serverId, path, decodeVoid, { method: "POST" }).pipe(Effect.catch(() => Effect.void));
      }
      this.#clearServerConnectionState(serverId);
      yield* this.#store.remove(serverId);
      this.#emitChanged();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * A wake request started this hosted server: show that it starts, and reconnect each few seconds
   * until it answers. The account client calls it for each wake, also one from settings.
   */
  hostedServerStarting(serverId: string): void {
    if (this.#stopping || !this.#store.has(serverId) || this.#connections.stateFor(serverId) === "online") return;
    this.#hostedStartRevision.set(serverId, (this.#hostedStartRevision.get(serverId) ?? 0) + 1);
    if (this.#connections.statusFor(serverId).hostedIssue === "plan_ended") this.#events.resumeReconnect(serverId);
    // Automatic wakes stop after an expired start, so this wake came from the user.
    this.#hostedStartExpired.delete(serverId);
    this.#connections.setHostedIssue(serverId, null);
    if (!this.#hostedStartAt.has(serverId)) {
      this.#hostedStartAt.set(serverId, Date.now());
      this.#hostedStartTimers.set(
        serverId,
        setTimeout(() => this.#expireHostedStart(serverId), HOSTED_SERVER_START_MS),
      );
    }
    this.#events.setHostStarting(serverId, true);
    if (this.#connections.setHostedSleep(serverId, "waking")) this.#emitChanged();
  }

  #wakeHostedServer(serverId: string): Effect.Effect<void> {
    const hosted = this.#hostedServers;
    if (!hosted || this.#stopping || this.#hostedWakePending.has(serverId)) return Effect.void;
    this.#hostedWakePending.add(serverId);
    const revision = this.#hostedStartRevision.get(serverId) ?? 0;
    const failed = (issue: HostedServerIssue = "wake_failed") => {
      if (
        this.#stopping ||
        !this.#store.has(serverId) ||
        this.#connections.stateFor(serverId) === "online" ||
        (this.#hostedStartRevision.get(serverId) ?? 0) !== revision
      )
        return;
      this.#clearHostedStart(serverId);
      this.#connections.setHostedSleep(serverId, null);
      this.#connections.setHostedIssue(serverId, issue);
      if (issue === "plan_ended") this.#events.suspendReconnect(serverId);
      this.#emitChanged();
    };
    this.#connections.setHostedSleep(serverId, "waking");
    this.#emitChanged();
    return Effect.forkIn(
      this.#owned(
        hosted.wake(serverId).pipe(
          Effect.tap((server) =>
            Effect.sync(() => {
              if (WAKE_RECONNECT_STATES.has(server.state)) this.hostedServerStarting(serverId);
              else failed();
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() =>
              failed(isDynamicRecord(failure.cause) && failure.cause.status === 402 ? "plan_ended" : "wake_failed"),
            ),
          ),
          Effect.ensuring(Effect.sync(() => this.#hostedWakePending.delete(serverId))),
        ),
      ),
      this.#scope,
    ).pipe(Effect.asVoid);
  }

  #checkHostedServer(serverId: string, wake: boolean): Effect.Effect<void> {
    return Effect.forkIn(
      this.#owned(this.#checkHostedServerEffect(serverId, wake).pipe(Effect.catch(() => Effect.void))),
      this.#scope,
    ).pipe(Effect.asVoid);
  }

  readonly #checkHostedServerEffect = Effect.fn("RemoteManager.checkHostedServer")(function* (
    this: RemoteServerManager,
    serverId: string,
    wake: boolean,
  ) {
    const hosted = this.#hostedServers;
    if (!hosted) return;
    const revision = this.#hostedStartRevision.get(serverId) ?? 0;
    const availability = yield* hosted.unavailable(serverId, wake);
    if (
      this.#stopping ||
      this.#hostedWakePending.has(serverId) ||
      (this.#hostedStartRevision.get(serverId) ?? 0) !== revision
    )
      return;
    // A later wake or connection owns the current state.
    if (availability === "waking" || this.#hostedStartAt.has(serverId) || !this.#store.has(serverId)) return;
    if (this.#connections.stateFor(serverId) === "online") return;
    this.#connections.setHostedSleep(serverId, availability === "sleeping" ? "sleeping" : null);
    if (availability === "ended") {
      this.#connections.setHostedIssue(serverId, "plan_ended");
      this.#events.suspendReconnect(serverId);
    }
    this.#emitChanged();
  });

  /** A hosted server starts after a wake request, so a missed connection is not news until the start time ends. */
  #awaitsHostedStart(serverId: string): boolean {
    const since = this.#hostedStartAt.get(serverId);
    if (since === undefined) return false;
    if (Date.now() - since < HOSTED_SERVER_START_MS) return true;
    this.#expireHostedStart(serverId);
    return false;
  }

  #clearHostedStart(serverId: string): void {
    clearTimeout(this.#hostedStartTimers.get(serverId));
    this.#hostedStartTimers.delete(serverId);
    this.#hostedStartAt.delete(serverId);
  }

  #expireHostedStart(serverId: string): void {
    this.#clearHostedStart(serverId);
    if (!this.#store.has(serverId) || this.#connections.stateFor(serverId) === "online") return;
    this.#hostedStartExpired.add(serverId);
    this.#events.setHostStarting(serverId, false);
    this.#connections.setHostedSleep(serverId, null);
    this.#connections.setHostedIssue(serverId, "start_timeout");
    this.#emitChanged();
  }

  #clearServerConnectionState(serverId: string): void {
    this.#hostedStartRevision.set(serverId, (this.#hostedStartRevision.get(serverId) ?? 0) + 1);
    this.#clearHostedStart(serverId);
    this.#hostedStartExpired.delete(serverId);
    this.#events.forget(serverId);
    this.#refresh.forget(serverId);
    this.#connections.forget(serverId);
    this.#client.forget(serverId);
    this.#presence.forget(serverId);
    this.#attachments.forget(serverId);
  }

  // The server comes first because every caller knows which one it means, and the decoder sits next
  // to the path it decodes. `init` is last and optional, so a plain GET reads as three arguments.

  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init: RemoteRequestInit = {},
  ): Effect.Effect<T, RemoteWorkflowError> {
    return this.#owned(RemoteRequest.use((service) => service.request(serverId, path, decoder, init))).pipe(
      Effect.withSpan("RemoteManager.request"),
    );
  }

  readonly duplicateAgent = Effect.fn("RemoteManager.duplicateAgent")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<DuplicateAgentResult, RemoteWorkflowError, RemoteRequest> {
      const key = `${serverId}\0${agentId}`;
      const operationId = this.#duplicateOperationIds.get(key) ?? randomUUID();
      this.#duplicateOperationIds.set(key, operationId);
      return yield* Effect.gen({ self: this }, function* () {
        const result = yield* this.request(
          serverId,
          TEAM_API_ROUTES.agent.duplicate(agentId),
          decodeDuplicateAgentResultFromHost,
          { method: "POST", body: { operationId }, timeoutMs: REMOTE_DUPLICATION_TIMEOUT_MS },
        );
        this.#duplicateOperationIds.delete(key);
        return result;
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            if (error instanceof RemoteRequestError && error.status >= 400 && error.status < 500) {
              this.#duplicateOperationIds.delete(key);
            }
            return yield* new RemoteWorkflowError({ cause: error });
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  listAgentConversationReads(
    serverId = this.#store.activeServerId,
  ): Effect.Effect<Record<string, ConversationReadState>, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agents.conversationReads, decodeConversationReadStates);
  }

  readAgentConversation(
    agentId: string,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationWithReadState, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agent.conversation(agentId), decodeConversationWithReadState);
  }

  readAgentConversationPage(
    agentId: string,
    anchor: ConversationPageAnchor = { type: "latest" },
    limit = 50,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationPage, RemoteWorkflowError> {
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.agent.conversationPage(agentId)}${pageQuery(anchor, limit)}`,
      decodeConversationPageFromHost,
    );
  }

  searchAgentConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    limit = 100,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationSearchPage, RemoteWorkflowError> {
    const parameters = new URLSearchParams({ q: query, limit: String(limit) });
    // A query parameter never reaches the JSON adapters, so it keeps the released spelling.
    if (agentId) parameters.set("botId", agentId);
    if (cursor) parameters.set("cursor", cursor);
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.messages.search}?${parameters.toString()}`,
      decodeConversationSearchPageFromHost,
    );
  }

  markAgentConversationRead(
    input: MarkConversationReadInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationReadState, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agent.conversationRead(input.agentId), decodeConversationReadState, {
      method: "POST",
      body: { throughMessageId: input.throughMessageId },
    });
  }

  getPresence(serverId = this.#store.activeServerId): TeamPresenceSnapshot {
    return this.#presence.get(serverId);
  }

  getPresenceFor(serverId: string): Effect.Effect<TeamPresenceSnapshot, RemoteWorkflowError> {
    return this.#owned(this.#presence.refresh(serverId));
  }

  readonly refreshIdentity = Effect.fn("RemoteManager.refreshIdentity")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.transport === "webrtc-v2" && transport) {
        yield* this.#syncWebRtcHosts();
        this.#connections.clearCompatibility(serverId);
        yield* this.#client.ensureCompatibility(server, true);
        this.#connections.clearIssue(serverId);
        this.#emitChanged();
        return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
      }
      const identity = yield* this.#client.verifyIdentity(server.apiUrl, server.id, server.fingerprint);
      this.#connections.setCompatibility(server.id, identity.compatibility);
      this.#connections.clearIssue(server.id);
      yield* this.#store.update(server.id, { name: identity.serverName, logoVersion: identity.logoVersion });
      this.#emitChanged();
      return yield* remoteDecode(() => requiredServerSummary(this.list(), server.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  listMembers(serverId: string): Effect.Effect<TeamMemberSummary[], RemoteWorkflowError> {
    return this.#owned(this.#team.listMembers(serverId));
  }

  updateMember(serverId: string, input: UpdateTeamMemberInput): Effect.Effect<TeamMemberSummary, RemoteWorkflowError> {
    return this.#owned(this.#team.updateMember(serverId, input));
  }

  removeMember(serverId: string, memberId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.#owned(this.#team.removeMember(serverId, memberId));
  }

  listInvites(serverId: string): Effect.Effect<TeamInviteSummary[], RemoteWorkflowError> {
    return this.#owned(this.#team.listInvites(serverId));
  }

  revokeInvite(serverId: string, inviteId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.#owned(this.#team.revokeInvite(serverId, inviteId));
  }

  createInvite(
    serverId: string,
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ): Effect.Effect<InviteSummary, RemoteWorkflowError> {
    return this.#owned(this.#team.createInvite(serverId, input));
  }

  readonly setTyping = Effect.fn("RemoteManager.setTyping")(function* (
    this: RemoteServerManager,
    input: SetTeamTypingInput,
    serverId = this.#store.activeServerId,
  ) {
    const server = this.#store.find(serverId);
    if (server?.transport === "webrtc-v2") {
      const transport = this.#webrtcTransport;
      if (transport)
        yield* Effect.forkIn(
          this.#owned(transport.setTyping(serverId, input.agentId, input.typing).pipe(Effect.catch(() => Effect.void))),
          this.#scope,
        );
      return;
    }
    this.#events.send(serverId, { type: "team-typing", ...input });
  }).bind(this);

  listDirectThreads(serverId = this.#store.activeServerId): Effect.Effect<DirectThreadSummary[], RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.threads, decodeDirectThreadSummaries);
  }

  readDirectConversation(
    memberId: string,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationSnapshot, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.conversation(memberId), decodeDirectConversationSnapshot);
  }

  readDirectConversationPage(
    memberId: string,
    anchor: DirectConversationPageAnchor = { type: "latest" },
    limit = 50,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationPage, RemoteWorkflowError> {
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.direct.conversationPage(memberId)}${pageQuery(anchor, limit)}`,
      decodeDirectConversationPage,
    );
  }

  sendDirectMessage(
    input: SendDirectMessageInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectMessage, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.messages, decodeDirectMessage, {
      method: "POST",
      body: input,
    });
  }

  markDirectRead(
    input: MarkDirectReadInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationReadState, RemoteWorkflowError> {
    return this.request(
      serverId,
      TEAM_API_ROUTES.direct.conversationRead(input.memberId),
      decodeDirectConversationReadState,
      { method: "POST", body: { throughSequence: input.throughSequence } },
    );
  }

  readonly setDirectTyping = Effect.fn("RemoteManager.setDirectTyping")(function* (
    this: RemoteServerManager,
    input: DirectTypingInput,
    serverId = this.#store.activeServerId,
  ) {
    const server = this.#store.find(serverId);
    if (server?.transport === "webrtc-v2") {
      const transport = this.#webrtcTransport;
      if (transport)
        yield* Effect.forkIn(
          this.#owned(
            transport.setDirectTyping(serverId, input.memberId, input.typing).pipe(Effect.catch(() => Effect.void)),
          ),
          this.#scope,
        );
      return;
    }
    this.#events.send(serverId, {
      type: "team-direct-typing",
      recipientMemberId: input.memberId,
      typing: input.typing,
    });
  }).bind(this);

  checkRemoteDesktopSetup(serverId: string) {
    if (!this.supportsCapability(serverId, REMOTE_DESKTOP_SETUP_CAPABILITY))
      throw new Error(sourceText("error.remote.desktopSetupHostUpdate"));
    return this.request(serverId, TEAM_API_ROUTES.remoteScreen.setup, decodeRemoteDesktopSetupFromHost, {
      method: "POST",
      body: {},
    });
  }

  testRemoteDesktop(input: RemoteDesktopTestInput) {
    if (!this.supportsCapability(input.serverId, REMOTE_DESKTOP_SETUP_CAPABILITY))
      throw new Error(sourceText("error.remote.desktopTestHostUpdate"));
    return this.request(input.serverId, TEAM_API_ROUTES.remoteScreen.test, decodeRemoteDesktopTestFromHost, {
      method: "POST",
      body: { sessionId: input.sessionId, action: input.action },
    });
  }

  readonly createRemoteDesktopSession = Effect.fn("RemoteManager.createRemoteDesktopSession")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<RemoteDesktopSession, RemoteWorkflowError, RemoteRequest> {
      const viewerProxy = this.#remoteViewerProxy;

      const session = yield* this.request(serverId, TEAM_API_ROUTES.remoteScreen.sessions, decodeRemoteDesktopSession, {
        method: "POST",
        body: {},
      });
      if ((yield* remoteDecode(() => this.#store.require(serverId))).transport !== "webrtc-v2") return session;
      if (!viewerProxy)
        return yield* new RemoteWorkflowError({
          cause: new Error(sourceText("error.remote.viewerProxyUnavailable")),
        });
      return {
        ...session,
        viewerUrl: yield* viewerProxy.viewerUrl(serverId, TEAM_API_ROUTES.remoteScreen.viewer(session.id)),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly fetchRemoteViewerResource = Effect.fn("RemoteManager.fetchRemoteViewerResource")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      path: string,
      init: RequestInit,
    ): Effect.fn.Return<Response, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.transport !== "webrtc-v2")
        return yield* new RemoteWorkflowError({
          cause: new Error(sourceText("error.remote.viewerTransportInvalid")),
        });
      return yield* this.#client.fetch(server, new URL(path, server.apiUrl), init, false);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * Asks a host for a live view of one tab and answers where its frames are. A WebRTC host has no
   * address the client can reach, so the socket goes through the same local proxy the remote screen
   * uses; a host on the network is opened directly, with the member's token as the subprotocol.
   */

  readonly openBrowserViewStream = Effect.fn("RemoteManager.openBrowserViewStream")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      tabId: string,
    ): Effect.fn.Return<{ sessionId: string; url: string; protocols: string[] }, RemoteWorkflowError, RemoteRequest> {
      const viewerProxy = this.#remoteViewerProxy;

      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const session = yield* this.request(
        serverId,
        TEAM_API_ROUTES.browser.viewSessions,
        decodeBrowserViewSessionResponse,
        { method: "POST", body: { tabId } },
      );
      if (server.transport === "webrtc-v2") {
        const attempt3 = yield* Effect.gen({ self: this }, function* () {
          if (!viewerProxy)
            return yield* new RemoteWorkflowError({
              cause: new Error(sourceText("error.remote.viewerProxyUnavailable")),
            });
          const url = new URL(yield* viewerProxy.viewerUrl(serverId, session.streamPath));
          url.protocol = "ws:";
          return { sessionId: session.id, url: url.toString(), protocols: [] };
        }).pipe(Effect.result);
        if (Result.isFailure(attempt3)) {
          const error = attempt3.failure.cause;
          // The host counts this session against its limit until it is deleted.
          yield* this.closeBrowserViewSession(serverId, session.id).pipe(Effect.catch(() => Effect.void));
          return yield* new RemoteWorkflowError({ cause: error });
        } else return attempt3.success;
      }
      const url = new URL(session.streamPath, server.apiUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return {
        sessionId: session.id,
        url: url.toString(),
        protocols: [`openbot-token.${this.#store.token(server)}`],
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  closeBrowserViewSession(serverId: string, sessionId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.browser.viewSession(sessionId), decodeVoid, { method: "DELETE" });
  }

  closeRemoteDesktopSession(serverId: string, sessionId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.remoteScreen.session(sessionId), decodeVoid, { method: "DELETE" });
  }

  selectRemoteDesktopDisplay(serverId: string, displayId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.remoteScreen.display, decodeVoid, {
      method: "PUT",
      body: { displayId },
    });
  }

  readonly uploadAttachment = Effect.fn("RemoteManager.uploadAttachment")(
    function* (
      this: RemoteServerManager,
      name: string,
      mimeType: string,
      bytes: Uint8Array,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<DraftAttachment, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.attachments, server.apiUrl);
      url.searchParams.set("name", name);
      url.searchParams.set("mime", mimeType || "application/octet-stream");
      const response = yield* this.#client.fetch(server, url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: Buffer.from(bytes),
      });
      const json = yield* remoteCall(() => response.json());
      return yield* remoteDecode(() =>
        addRemotePreviewUrls(
          decodeDraftAttachment(decodeTeamProtocolV1CurrentHttpResponse("POST", url.pathname, response.status, json)),
          server.id,
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** Sends a Grok Bot export to the host with `agent-import-v1` and answers its preview. */

  readonly stageAgentImport = Effect.fn("RemoteManager.stageAgentImport")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      bytes: Uint8Array,
    ): Effect.fn.Return<AgentImportPreview, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(AGENT_IMPORT_ROUTES.stage, server.apiUrl);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/zip" }, body: Buffer.from(bytes) },
        true,
        AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      );
      const value = yield* remoteCall(() => response.json());
      return yield* remoteDecode(() => decodeRemoteAgentImportPreview(value));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly setAgentAvatar = Effect.fn("RemoteManager.setAgentAvatar")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      image: AvatarImageInput | null,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<AgentSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.agent.avatar(agentId), server.apiUrl);
      const headers = new Headers();
      if (image) headers.set("Content-Type", image.mimeType);
      const response = yield* this.#client.fetch(server, url, {
        method: image ? "PUT" : "DELETE",
        headers,
        body: image ? Buffer.from(image.bytes) : undefined,
      });
      const json = yield* remoteCall(() => response.json());
      const value = yield* remoteDecode(() =>
        decodeTeamProtocolV1CurrentHttpResponse(image ? "PUT" : "DELETE", url.pathname, response.status, json),
      );
      return addRemotePreviewUrls(yield* remoteDecode(() => decodeAgentSummary(value)), server.id);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadAgentAvatar = Effect.fn("RemoteManager.downloadAgentAvatar")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      serverId = this.#store.activeServerId,
      version?: string,
    ): Effect.fn.Return<{ bytes: Uint8Array; mimeType: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.agent.avatar(agentId), server.apiUrl);
      if (version) url.searchParams.set("v", version);
      const response = yield* this.#client.fetch(server, url);
      return {
        bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
        mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadServerLogo = Effect.fn("RemoteManager.downloadServerLogo")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      version: string,
    ): Effect.fn.Return<{ bytes: Uint8Array; mimeType: string }, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.logoVersion !== version)
        return yield* new RemoteWorkflowError({ cause: new Error("Server logo version is not current.") });
      if (server.transport === "webrtc-v2" && transport) {
        const logo = yield* transport.downloadHostLogo(serverId, version);
        if (!isValidAvatarImage(logo.mimeType, logo.bytes))
          return yield* new RemoteWorkflowError({ cause: new Error("Server logo response is invalid.") });
        return logo;
      }
      const url = new URL(TEAM_API_ROUTES.team.logo, server.apiUrl);
      url.searchParams.set("v", version);
      const response = yield* this.#client.fetch(server, url);
      const bytes = new Uint8Array(yield* remoteCall(() => response.arrayBuffer()));
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      if (!isValidAvatarImage(mimeType, bytes))
        return yield* new RemoteWorkflowError({ cause: new Error("Server logo response is invalid.") });
      return { bytes, mimeType };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadAttachment = Effect.fn("RemoteManager.downloadAttachment")(
    function* (
      this: RemoteServerManager,
      attachmentId: string,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<RemoteAttachment, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      return yield* this.#attachments.get(server.id, attachmentId, () =>
        this.#owned(
          Effect.gen({ self: this }, function* () {
            const response = yield* this.#client.fetch(
              server,
              new URL(TEAM_API_ROUTES.attachment(attachmentId), server.apiUrl),
            );
            return {
              bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
              name: contentDispositionFileName(response.headers.get("content-disposition"), attachmentId),
              mimeType: response.headers.get("content-type") ?? "application/octet-stream",
            };
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadSharedFile = Effect.fn("RemoteManager.downloadSharedFile")(
    function* (
      this: RemoteServerManager,
      sharedPath: string,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<{ bytes: Uint8Array; name: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.sharedFiles, server.apiUrl);
      url.searchParams.set("path", sharedPath);
      const response = yield* this.#client.fetch(server, url);
      return {
        bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
        name: contentDispositionFileName(response.headers.get("content-disposition"), basename(sharedPath)),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadWorkspaceFile = Effect.fn("RemoteManager.downloadWorkspaceFile")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      workspacePath: string,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<{ bytes: Uint8Array; name: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.workspaceFiles, server.apiUrl);
      // A query parameter never reaches the JSON adapters, so it keeps the released spelling.
      url.searchParams.set("botId", agentId);
      url.searchParams.set("path", workspacePath);
      const response = yield* this.#client.fetch(server, url);
      return {
        bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
        name: contentDispositionFileName(response.headers.get("content-disposition"), basename(workspacePath)),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly stop = Effect.fn("RemoteManager.stop")(function* (this: RemoteServerManager) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const done = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = done;
    return yield* Effect.gen({ self: this }, function* () {
      for (const serverId of this.#hostedStartTimers.keys()) this.#clearHostedStart(serverId);
      yield* this.#events.stop();
      this.#refresh.clear();
      this.#client.clear();
      this.#attachments.clear();
      if (this.#remoteViewerProxy) yield* this.#remoteViewerProxy.stop().pipe(Effect.catch(() => Effect.void));
      if (this.#webrtcTransport) yield* this.#webrtcTransport.stop().pipe(Effect.catch(() => Effect.void));
      yield* Scope.close(this.#scope, Exit.void);
      while (this.#operations.size)
        yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
      yield* this.#selections.withPermit(Effect.void);
      this.#stopped = true;
    }).pipe(Effect.onExit((exit) => Deferred.done(done, exit)));
  }).bind(this);

  /** Whether a client-side file transfer is moving right now, either direction. */
  hasActiveTransfers(): boolean {
    return this.#webrtcTransport?.hasActiveTransfers() ?? false;
  }

  readonly disconnectRemoteSessions = Effect.fn("RemoteManager.disconnectRemoteSessions")(
    function* (this: RemoteServerManager): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      const transport = this.#webrtcTransport;

      // A copy skips the host's check of the account, so the next account must not see it.
      this.#attachments.clear();
      if (!transport) return;
      // First: a session kept for the next run belongs to the account that leaves.
      yield* transport.forgetStoredSessions();
      yield* Effect.forEach(
        this.#store.servers.filter((server) => server.transport === "webrtc-v2"),
        (server) => transport.disconnect(server.id),
        { concurrency: "unbounded", discard: true },
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #syncWebRtcHosts = Effect.fn("RemoteManager.syncWebRtcHosts")(function* (
    this: RemoteServerManager,
  ): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
    const transport = this.#webrtcTransport;
    if (!transport) return;
    yield* this.#directorySync.withPermit(this.#syncWebRtcHostsOnce(transport));
  });

  readonly #syncWebRtcHostsOnce = Effect.fn("RemoteManager.syncWebRtcHostsOnce")(function* (
    this: RemoteServerManager,
    transport: TeamWebRtcClientTransport,
  ): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
    const hosts = yield* transport.listHosts();
    // The account can be signed out or not loaded yet; that is a failed read, not a defect.
    const email = yield* remoteDecode(() => this.#centralAccount.getEmail());
    const localHostId = this.#getLocalHostId();
    this.#localMemberLimit = hosts.find((host) => host.hostId === localHostId)?.memberLimit ?? null;
    const { servers, removedHostIds, staleTransportHostIds, pinnedKeys } = reconcileWebRtcHosts({
      hosts,
      isConnected: (hostId) => transport.isConnected(hostId),
      servers: this.#store.servers,
      preservedIdentities: this.#store.preservedIdentities,
      localHostId,
      isHiddenHost: (hostId) => this.#store.isHiddenHost(hostId),
      username: email.trim().toLowerCase(),
      keepOtherTransports: this.#allowLocalDevelopmentInvites,
    });
    for (const { hostId, publicKey } of pinnedKeys) transport.pinHostKey(hostId, publicKey);
    for (const serverId of removedHostIds) {
      yield* transport.disconnect(serverId).pipe(Effect.catch(() => Effect.void));
      this.#clearServerConnectionState(serverId);
    }
    // Before the store changes, because after it `ensure` answers for the new entry: it branches on
    // the transport it finds and starts the WebRTC one beside an HTTPS controller it never aborts,
    // so both would deliver the same events and the socket for an entry that no longer exists could
    // still mark a healthy host offline. No `disconnect` -- see `staleTransportHostIds`.
    for (const serverId of staleTransportHostIds) this.#clearServerConnectionState(serverId);
    yield* this.#store.replaceServers(servers);
  });

  #handleWebRtcEvent(serverId: string, event: AgentEvent | TeamRealtimeEvent): void {
    if (event.type === "team-identity") {
      this.#applyServerIdentity(serverId, event);
    } else if (event.type === "team-presence") {
      this.#presence.accept(serverId, event.snapshot);
    } else if (event.type === "team-direct-message") this.emit("directMessage", serverId, event);
    else if (event.type === "team-direct-typing") this.emit("directTyping", serverId, event);
    else if (event.type === "host-restart") this.#applyHostRestart(serverId, event);
    else this.#background(this.#owned(this.#refresh.forward(serverId, event)));
  }

  /** A host that restarts into an update is away for a short time: it keeps the fast retry for a limited time. */
  #awaitsHostRestart(serverId: string): boolean {
    if (!this.#connections.hostRestartFor(serverId)) return false;
    const now = Date.now();
    const since = this.#hostRestartAway.get(serverId) ?? now;
    this.#hostRestartAway.set(serverId, since);
    if (now - since < HOST_RESTART_RETRY_MS) return true;
    this.#hostRestartAway.delete(serverId);
    if (this.#connections.setHostRestart(serverId, null)) this.#emitChanged();
    return false;
  }

  #applyHostRestart(serverId: string, { state, version }: HostRestartEvent): void {
    if (this.#connections.setHostRestart(serverId, state === "none" ? null : { state, version })) this.#emitChanged();
  }

  // Best effort, the same as the screen sharing flag. The host sends an identity whenever it changes,
  // so a store that cannot be written must not turn one of them into an uncaught exception in the main
  // process. The new name stays in memory and the next write of any field saves it.
  #applyServerIdentity(serverId: string, identity: { serverName: string; logoVersion: string | null }): void {
    this.#background(
      this.#owned(
        this.#store.update(serverId, { name: identity.serverName, logoVersion: identity.logoVersion }).pipe(
          Effect.tap(() => Effect.sync(() => this.#emitChanged())),
          Effect.catch(() => Effect.void),
        ),
      ),
    );
  }

  #emitChanged(): void {
    this.emit("changed", this.list());
  }
}

function requiredServerSummary(servers: ServerSummary[], serverId: string): ServerSummary {
  const server = servers.find((candidate) => candidate.id === serverId);
  if (!server) throw new Error("Remote server summary is missing.");
  return server;
}
