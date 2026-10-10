import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_TURN_REFRESH_INTERVAL_MS,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2RpcFrame,
  decodeTeamProtocolV7CurrentEvent,
  decodeTeamProtocolV7WebRtcHttpResponse,
  encodeTeamProtocolV2Frame,
  encodeTeamProtocolV7WebRtcHttpRequest,
  TEAM_PROTOCOL_V2_CHANNELS,
  type TeamProtocolV2AuthFrame,
  type TeamProtocolV2Json,
  teamCapabilitiesForProtocol,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  type TeamProtocolV1CurrentEventControl,
  toWireTeamProtocolV1ClientEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { decodeTeamProtocolSupportV7Base } from "@openbot/contracts/team-protocol/v7-base";
import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Result, Schema, Scope, Semaphore } from "effect";
import { base64UrlToBytes, bytesToBase64Url } from "./base64";
import { createEd25519Identity, type Ed25519Identity, signEd25519, verifyEd25519Pem } from "./ed25519";

class RemotePeerError extends Schema.TaggedError<RemotePeerError>()("RemotePeerError", { message: Schema.String }) {}
const peerError = (error: unknown) =>
  new RemotePeerError({ message: error instanceof Error ? error.message : sourceText("error.remote.operationFailed") });
const peerCall = <A>(operation: () => Promise<A> | A) =>
  Effect.tryPromise({ try: async () => operation(), catch: peerError });
const peerDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: peerError });

import { createRemoteFileReceiver } from "./file-download";
import { createRemoteFileSender, type RemoteFileUpload } from "./file-upload";

export type { RemoteFileUpload } from "./file-upload";
export { MOBILE_ATTACHMENT_BYTES } from "./file-upload";

import { createTeamRequestId } from "./request-id";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./webrtc-framing";
export type RemoteTeamCommand =
  | { id: string; type: "connect"; hostId: string; hostPublicKey: string }
  | { id: string; type: "disconnect" }
  | {
      id: string;
      type: "request";
      method: string;
      path: string;
      body: TeamProtocolV2Json;
      upload?: RemoteFileUpload;
      timeoutMs?: number;
    };

export interface RemoteTeamBootstrapPayload {
  sessionId: string;
  signalUrl: string;
  ticket: string;
}

export interface RemoteTeamCommandResult {
  commandId: string;
  ok: boolean;
  status?: number;
  body?: TeamProtocolV2Json;
  error?: string;
}

/** Carries every outstanding command across the native/DOM bridge, keyed by request ID. */
export function createRemoteCommandMailbox(publish: (commands: RemoteTeamCommand[]) => void) {
  const pending = new Map<string, { command: RemoteTeamCommand; resolve: (result: RemoteTeamCommandResult) => void }>();
  let target: { hostId: string; hostPublicKey: string } | null = null;
  const cancel = () => {
    for (const [commandId, entry] of pending) {
      entry.resolve({ commandId, ok: false, error: sourceText("error.remote.serverConnectionReplaced") });
    }
    pending.clear();
  };
  return {
    send(command: RemoteTeamCommand): Promise<RemoteTeamCommandResult> {
      if (command.type === "disconnect") {
        cancel();
        target = null;
      } else if (command.type === "connect") {
        if (target?.hostId !== command.hostId || target.hostPublicKey !== command.hostPublicKey) cancel();
        // A foreground refresh may reuse a healthy peer. Do not reject its live RPCs;
        // the peer itself rejects them if this turns out to require a reconnect.
        target = { hostId: command.hostId, hostPublicKey: command.hostPublicKey };
      }
      return new Promise((resolve) => {
        pending.set(command.id, { command, resolve });
        publish([...pending.values()].map((entry) => entry.command));
      });
    },
    receive(result: RemoteTeamCommandResult) {
      const entry = pending.get(result.commandId);
      if (!entry) return;
      pending.delete(result.commandId);
      entry.resolve(result);
      publish([...pending.values()].map((item) => item.command));
    },
    dispose: cancel,
  };
}

export interface RemoteTeamConnectionUpdate {
  hostId: string;
  state: "connecting" | "online" | "offline";
  message: string | null;
  /**
   * Set when no reconnect can fix this failure, because the two ends disagree about the wire rather
   * than about whether there is one. A consumer that retries every offline update has to be told
   * the difference, or it retries into the same frame forever.
   */
  code?: "protocol_error" | "session_revoked";
  resync?: boolean;
  /**
   * With `state: "connecting"`: the host is not connected to Signal. Signal holds this attempt and
   * continues it when the host connects, so the consumer must not start another attempt.
   */
  hostOffline?: true;
}

/**
 * One step of a connection, for the support log on the device. It names no ticket, token, address,
 * candidate or content: `detail` is a fixed state, a number, or the English error the peer reports.
 */
export interface RemoteTeamDiagnostic {
  hostId: string;
  step:
    | "signal-open"
    | "signal-closed"
    | "signal-ready"
    | "signal-retry"
    | "host-waiting"
    | "peer-state"
    | "route"
    | "ice-recovery"
    | "channels-open"
    | "authenticated"
    | "failed";
  detail?: string;
}

/** How much of one upload command's file has been sent. */
export interface RemoteUploadProgress {
  commandId: string;
  sent: number;
  total: number;
}

export interface RemoteTeamPeerActions {
  onHostStreamData?: (data: string | ArrayBuffer) => void;
  /** Hears upload progress, at most once per whole percent. Optional, and never affects the upload. */
  onUploadProgress?: (progress: RemoteUploadProgress) => Promise<void>;
  onAccountProfileChanged?: () => Promise<void>;
  /** The account's server list changed on another device of this account. */
  onAccountServersChanged?: () => Promise<void>;
  /** `existingSessionId` is a session kept from a failed attempt on the same host; reuse it when it is still active. */
  getBootstrap: (
    hostId: string,
    clientPublicKey: string,
    existingSessionId: string | null,
  ) => Promise<RemoteTeamBootstrapPayload>;
  endSession: (sessionId: string) => Promise<void>;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => Promise<void>;
  /** Hears connection steps. Optional, and never affects the connection. */
  onDiagnostic?: (diagnostic: RemoteTeamDiagnostic) => Promise<void>;
  /** The platform reported that the network came back. A consumer that waits to retry can retry now. */
  onNetworkRestored?: () => Promise<void>;
  onTeamEvent: (hostId: string, event: AgentEvent | TeamRealtimeEvent) => Promise<void>;
}
interface ActionsRef {
  current: RemoteTeamPeerActions;
}
type ChannelKind = "rpc" | "events" | "files" | "desktop";

interface PendingRequest {
  method: string;
  path: string;
  resolve: (value: { status: number; body: TeamProtocolV2Json }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PeerState {
  generation: number;
  hostId: string;
  hostPublicKey: string;
  sessionId: string;
  ticket: string;
  resumeToken: string | null;
  signalUrl: string;
  socket: WebSocket | null;
  signalLock: Semaphore.Semaphore;
  connectionId: string | null;
  connection: RTCPeerConnection | null;
  channels: Partial<Record<ChannelKind, RTCDataChannel>>;
  decoders: Partial<Record<ChannelKind, TeamWebRtcPayloadDecoder>>;
  channelLocks: Partial<Record<ChannelKind, Semaphore.Semaphore>>;
  identity: Ed25519Identity;
  clientPublicKey: string;
  clientNonce: string;
  hostNonce: string | null;
  binding: { clientFingerprint: string; hostFingerprint: string } | null;
  authenticated: boolean;
  closed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  turnRefreshTimer: ReturnType<typeof setTimeout> | null;
  /** When the TURN credentials must be renewed. Background time does not move it. */
  turnRefreshDueAt: number;
  iceServers: RTCIceServer[];
  /** Set by `renewSignal`: the path can be dead while the connection still reports `connected`. */
  restartIceOnReady: boolean;
  lastEventSequence: number;
  needsResync: boolean;
  connected: Deferred.Deferred<void, RemotePeerError> | null;
  readonly abort: AbortController;
  connectedTimer: ReturnType<typeof setTimeout> | null;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
  iceRecoveryTimer: ReturnType<typeof setTimeout> | null;
  /** Signal holds this socket until the host connects. The connect deadline starts at `ready`. */
  waitingForHost: boolean;
  hostWaitTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Signal sent `ready` on the current socket. Signal gives each `hello` a new connection ID, so a
   * frame sent before `ready` carries the old ID, and Signal rejects it.
   */
  signalReady: boolean;
  /** The host answered a request on this peer, so its channels worked after authentication. */
  answeredRequest: boolean;
  hostProtocol?: number;
}

const CHANNELS: ChannelKind[] = ["rpc", "events", "files", "desktop"];
/** How long a peer with a lost ICE path can recover before it is replaced with a new session. */
const DISCONNECT_GRACE_MS = 15_000;
/** ICE often recovers a short loss by itself. After this wait, the peer restarts ICE. */
const ICE_RESTART_DELAY_MS = 2_000;
/** A Signal socket from before a network change can read as open and deliver nothing. */
const SIGNAL_RENEW_DELAY_MS = 8_000;
/** A socket that waits for the host is renewed with its resume token, so a dead socket does not wait forever. */
const HOST_WAIT_RENEW_MS = 60_000;
const COMPATIBILITY_REQUEST_TIMEOUT_MS = 3_000;
/** The first read on a new peer also waits for a slow relay path, such as TURN over TLS on mobile data. */
const FIRST_COMPATIBILITY_REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000 + 30_000;

class RemotePeerIO extends Context.Service<
  RemotePeerIO,
  {
    bootstrap(
      hostId: string,
      publicKey: string,
      sessionId: string | null,
    ): Effect.Effect<RemoteTeamBootstrapPayload, RemotePeerError>;
    connectionUpdate(update: RemoteTeamConnectionUpdate): Effect.Effect<void, RemotePeerError>;
    teamEvent(hostId: string, event: AgentEvent | TeamRealtimeEvent): Effect.Effect<void, RemotePeerError>;
  }
>()("@openbot/team-client/RemotePeerIO") {
  static layer(actions: ActionsRef) {
    return Layer.succeed(
      RemotePeerIO,
      RemotePeerIO.of({
        bootstrap: Effect.fn("RemotePeerIO.bootstrap")((hostId: string, publicKey: string, sessionId: string | null) =>
          peerCall(() => actions.current.getBootstrap(hostId, publicKey, sessionId)),
        ),
        connectionUpdate: Effect.fn("RemotePeerIO.connectionUpdate")((update: RemoteTeamConnectionUpdate) =>
          peerCall(() => actions.current.onConnectionUpdate(update)),
        ),
        teamEvent: Effect.fn("RemotePeerIO.teamEvent")((hostId: string, event: AgentEvent | TeamRealtimeEvent) =>
          peerCall(() => actions.current.onTeamEvent(hostId, event)),
        ),
      }),
    );
  }
}

/**
 * `waitForHost` asks Signal to hold an attempt while the host is offline, rather than fail it. The
 * consumer must handle the `hostOffline` update.
 */
export function createRemoteTeamPeer(actions: ActionsRef, options: { waitForHost?: boolean } = {}) {
  const runtime = ManagedRuntime.make(RemotePeerIO.layer(actions));
  const workScope = Scope.makeUnsafe();
  const running = new Set<Promise<unknown>>();

  function runPeerEffect<A, E>(operation: Effect.Effect<A, E, RemotePeerIO>): Promise<A> {
    const pending = runtime.runPromise(Effect.result(operation)).then((result) => {
      if (Result.isFailure(result)) throw result.failure;
      return result.success;
    });
    running.add(pending);
    return pending.finally(() => running.delete(pending));
  }

  let active = true;
  let peer: PeerState | null = null;
  // Keep the rate-limit wait when recovery replaces a peer or the app returns to the foreground.
  let signalRetryAt = 0;
  let generation = 0;
  const pendingRequests = new Map<string, PendingRequest>();
  const files = createRemoteFileSender(
    (data) =>
      Effect.suspend(() => {
        const state = peer;
        if (!state || !isPeerOnline(state))
          return Effect.fail(new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") }));
        return sendPayload(state, "files", data);
      }),
    () => createTeamRequestId((size) => crypto.getRandomValues(new Uint8Array(size))),
  );
  const downloads = createRemoteFileReceiver((data) =>
    Effect.suspend(() => {
      const state = peer;
      if (!state || !isPeerOnline(state))
        return Effect.fail(new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") }));
      return sendPayload(state, "files", data);
    }),
  );
  const closingSessions = new Map<string, Deferred.Deferred<void>>();
  // A failed attempt keeps its session for the next attempt on the same host. Ending it each time
  // made every recovery attempt a create, a ticket and an end on the account Worker.
  let retainedSession: { hostId: string; sessionId: string } | null = null;

  return {
    async sendHostStreamData(data: string | ArrayBuffer) {
      const state = peer;
      if (!state || !isPeerOnline(state)) throw new Error(sourceText("error.remote.hostConnectionOffline"));
      await runPeerEffect(sendPayload(state, "desktop", data));
    },
    cancelUpload: () => runPeerEffect(files.cancelUpload()),
    /** Tells the host which agent this member is writing to. The host clears it after a few seconds. */
    setTyping(agentId: string | null, typing: boolean) {
      const state = peer;
      if (!state || !isPeerOnline(state)) return;
      void runPeerEffect(sendEventControl(state, { type: "team-typing", agentId, typing })).catch(() => undefined);
    },
    execute: (command: RemoteTeamCommand) => runPeerEffect(executeCommand(command, actions)),
    dispose: async () => {
      active = false;
      await runPeerEffect(closePeer(actions.current.endSession));
      await runPeerEffect(releaseRetainedSession(actions.current.endSession));
      // SDK calls may not support cancellation. Drain them so a late bootstrap
      // can end its session, and pending mutations keep their existing result.
      await Promise.allSettled([...running]);
      await runPeerEffect(Scope.close(workScope, Exit.void));
      await runtime.dispose();
    },
    setActive(value: boolean) {
      active = value;
      const state = peer;
      if (!state) return;
      if (!active) {
        if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
        if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
        if (state.disconnectedTimer !== null) clearTimeout(state.disconnectedTimer);
        if (state.iceRecoveryTimer !== null) clearTimeout(state.iceRecoveryTimer);
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        state.hostWaitTimer = null;
        state.disconnectedTimer = null;
        state.iceRecoveryTimer = null;
        state.reconnectTimer = null;
        state.turnRefreshTimer = null;
        // The host can commit a sent write while the app is inactive. Keep its
        // response registered so the caller does not offer to send it again.
        state.needsResync ||= [...pendingRequests.values()].some(
          (request) => request.method === "GET" || request.method === "HEAD",
        );
        rejectRequests(new Error(sourceText("error.remote.appInBackground")), true);
        if (!state.authenticated) failPeer(state, new Error(sourceText("error.remote.appInBackground")), actions);
      } else {
        if (canRecoverPeer(state)) {
          recoverIce(state, actions, 0);
        } else if (!isPeerOnline(state)) {
          failPeer(state, new Error(sourceText("error.remote.desktopRestoreNeeded")), actions);
        } else {
          resumeTurnRefresh(state);
          if (!state.socket) openSignal(state, actions);
          // The recovery owner reloads workspace reads on every foreground return.
          // Do not request a second reload for reads canceled on background entry.
          state.needsResync = false;
        }
      }
    },
    /**
     * The platform saw the network come back, such as after a dead zone on mobile data. The path
     * and the Signal socket from before can both be dead, so renew the socket: its `ready` restarts
     * ICE on the authenticated peer. An attempt that is still connecting keeps its own deadline.
     */
    networkRestored() {
      const state = peer;
      if (active && state && !state.closed && (state.authenticated || state.waitingForHost))
        renewSignal(state, actions);
      void runPeerEffect(peerCall(() => actions.current.onNetworkRestored?.())).catch(() => undefined);
    },
  };
  function diagnosticCall(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string) {
    const diagnostic: RemoteTeamDiagnostic = { hostId: state.hostId, step, ...(detail ? { detail } : {}) };
    return peerCall(() => actions.current.onDiagnostic?.(diagnostic));
  }

  /** For native callbacks. Effect code yields `notify(diagnosticCall(...))` instead. */
  function diagnose(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string): void {
    void runPeerEffect(diagnosticCall(state, step, detail)).catch(() => undefined);
  }

  /** Starts a consumer callback in the peer's work scope without waiting for it; a failure is ignored. */
  function notify<A, E>(operation: Effect.Effect<A, E, RemotePeerIO>) {
    return Effect.forkIn(operation.pipe(Effect.ignore), workScope, { startImmediately: true });
  }

  /** The candidate types of the selected pair, such as `relay/udp -> host/udp`. Never the addresses. */
  function reportRoute(state: PeerState, connection: RTCPeerConnection) {
    return Effect.fn("RemotePeer.reportRoute")(function* () {
      const stats = yield* peerCall(() => connection.getStats());
      let route: string | null = null;
      stats.forEach((report) => {
        if (route || report.type !== "candidate-pair" || report.state !== "succeeded" || !report.nominated) return;
        route = `${candidateRoute(stats.get(report.localCandidateId))} -> ${candidateRoute(stats.get(report.remoteCandidateId))}`;
      });
      if (route) yield* notify(diagnosticCall(state, "route", route));
    })();
  }

  function candidateRoute(candidate: { candidateType?: string; protocol?: string } | undefined): string {
    return `${candidate?.candidateType ?? "unknown"}/${candidate?.protocol ?? "unknown"}`;
  }

  function isPeerOnline(state: PeerState): boolean {
    return (
      state.authenticated &&
      state.connection?.connectionState === "connected" &&
      CHANNELS.every((kind) => state.channels[kind]?.readyState === "open")
    );
  }
  function canRecoverPeer(state: PeerState): boolean {
    const connectionState = state.connection?.connectionState;
    // An authenticated peer is `connecting` only during an ICE restart.
    return (
      state.authenticated &&
      (connectionState === "disconnected" || connectionState === "failed" || connectionState === "connecting") &&
      CHANNELS.every((kind) => state.channels[kind]?.readyState === "open")
    );
  }

  /**
   * A lost ICE path, such as a phone that moved from Wi-Fi to mobile data, keeps the authenticated
   * session. Restart ICE on the current Signal socket first. If the path is still lost, open a new
   * socket, because the old one can be half-open after a network change; its `ready` restarts ICE
   * again. Only the grace deadline replaces the peer.
   */
  function recoverIce(state: PeerState, actions: ActionsRef, delay: number): void {
    scheduleDisconnectedCheck(state, actions);
    if (!active || state.iceRecoveryTimer !== null) return;
    diagnose(state, "ice-recovery", `in ${delay} ms`);
    // A restart moves the state to `connecting`, so wait for `online`, not for `disconnected`.
    const canContinue = () => active && !state.closed && peer === state && state.authenticated && !isPeerOnline(state);
    state.iceRecoveryTimer = setTimeout(() => {
      state.iceRecoveryTimer = null;
      if (!canContinue()) return;
      // A socket that did not get `ready` yet restarts ICE when `ready` arrives.
      if (canSignal(state)) void runPeerEffect(restartIce(state)).catch(() => undefined);
      else if (!state.socket) renewSignal(state, actions);
      state.iceRecoveryTimer = setTimeout(() => {
        state.iceRecoveryTimer = null;
        if (canContinue()) renewSignal(state, actions);
      }, SIGNAL_RENEW_DELAY_MS);
    }, delay);
  }

  function renewSignal(state: PeerState, actions: ActionsRef): void {
    if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    const socket = state.socket;
    state.restartIceOnReady = true;
    // Clear it first, so the close handler does not schedule a second reconnect.
    state.socket = null;
    socket?.close();
    openSignal(state, actions);
  }

  function scheduleDisconnectedCheck(state: PeerState, actions: ActionsRef): void {
    if (!active || state.disconnectedTimer !== null) return;
    state.disconnectedTimer = setTimeout(() => {
      state.disconnectedTimer = null;
      if (!isPeerOnline(state)) failPeer(state, new Error(sourceText("error.remote.desktopOffline")), actions);
    }, DISCONNECT_GRACE_MS);
  }

  function resyncIfNeeded(state: PeerState, actions: ActionsRef): void {
    if (!active || !isPeerOnline(state) || !state.needsResync) return;
    state.needsResync = false;
    void runPeerEffect(
      peerCall(() =>
        actions.current.onConnectionUpdate({ hostId: state.hostId, state: "online", message: null, resync: true }),
      ),
    );
  }

  function executeCommand(
    command: RemoteTeamCommand,
    actions: ActionsRef,
  ): Effect.Effect<RemoteTeamCommandResult, RemotePeerError, RemotePeerIO> {
    return Effect.fn("RemotePeer.executeCommand")(function* () {
      let commandGeneration = generation;
      const result = yield* Effect.gen(function* () {
        if (command.type === "connect") {
          if (!active) return yield* new RemotePeerError({ message: sourceText("error.remote.appInBackground") });
          if (peer && peer.hostId === command.hostId && peer.hostPublicKey === command.hostPublicKey) {
            if (canRecoverPeer(peer)) {
              const recovering = peer;
              recoverIce(recovering, actions, 0);
              recovering.connected ??= Deferred.makeUnsafe<void, RemotePeerError>();
            }
            if (peer.connected) {
              const connected = peer.connected;
              yield* Deferred.await(connected);
              return { commandId: command.id, ok: true };
            }
          }
          if (
            peer &&
            isPeerOnline(peer) &&
            peer.hostId === command.hostId &&
            peer.hostPublicKey === command.hostPublicKey
          ) {
            return { commandId: command.id, ok: true };
          }
          // Tear down locally now; connectPeer only waits for this host's cleanup.
          yield* Effect.forkIn(closePeer(actions.current.endSession), workScope, {
            startImmediately: true,
            uninterruptible: true,
          });
          commandGeneration = generation + 1;
          yield* connectPeerEffect(command.hostId, command.hostPublicKey, actions);
          return { commandId: command.id, ok: true };
        }
        if (command.type === "disconnect") {
          yield* closePeer(actions.current.endSession);
          yield* releaseRetainedSession(actions.current.endSession);
          return { commandId: command.id, ok: true };
        }
        let reported = -1;
        const response = yield* requestEffect(
          command.method,
          command.path,
          command.body,
          command.upload,
          (sent, total) => {
            const percent = total > 0 ? Math.floor((sent / total) * 100) : 100;
            if (percent === reported) return;
            reported = percent;
            void runPeerEffect(
              peerCall(() => actions.current.onUploadProgress?.({ commandId: command.id, sent, total })),
            ).catch(() => undefined);
          },
          command.timeoutMs,
        );
        return { commandId: command.id, ok: true, status: response.status, body: response.body };
      }).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure;
      {
        const message = error.message;
        if (command.type === "connect" && commandGeneration === generation) {
          yield* RemotePeerIO.use((io) => io.connectionUpdate({ hostId: command.hostId, state: "offline", message }));
        }
        return {
          commandId: command.id,
          ok: false,
          error: message,
        };
      }
    })();
  }

  function connectPeerEffect(hostId: string, hostPublicKey: string, actions: ActionsRef) {
    return Effect.fn("RemotePeer.connectPeer")(function* () {
      if (!active) return yield* new RemotePeerError({ message: sourceText("error.remote.appInBackground") });
      const currentGeneration = ++generation;
      yield* RemotePeerIO.use((io) => io.connectionUpdate({ hostId, state: "connecting", message: null }));
      const identity = yield* createEd25519Identity((size) => crypto.getRandomValues(new Uint8Array(size)));
      // The account API reuses an active logical session. A same-host bootstrap
      // must not race its revocation, even when failPeer already cleared `peer`.
      // Cleanup for a different host must never block switching servers.
      while (closingSessions.has(hostId)) {
        const closing = closingSessions.get(hostId);
        if (closing) yield* Deferred.await(closing);
      }
      if (currentGeneration !== generation || !active)
        return yield* new RemotePeerError({ message: sourceText("error.remote.connectionReplaced") });
      const clientPublicKey = identity.publicKeyPem;
      const existingSessionId = retainedSession?.hostId === hostId ? retainedSession.sessionId : null;
      // Cleanup for a different host must never block switching servers.
      yield* Effect.forkIn(releaseRetainedSession(actions.current.endSession, hostId), workScope, {
        startImmediately: true,
        uninterruptible: true,
      });
      // A failed bootstrap keeps the session for the next attempt.
      const bootstrap = yield* RemotePeerIO.use((io) => io.bootstrap(hostId, clientPublicKey, existingSessionId));
      if (retainedSession?.sessionId === existingSessionId) retainedSession = null;
      if (currentGeneration !== generation || !active) {
        yield* peerCall(() => actions.current.endSession(bootstrap.sessionId)).pipe(Effect.catch(() => Effect.void));
        return yield* new RemotePeerError({ message: sourceText("error.remote.connectionReplaced") });
      }
      const state: PeerState = {
        generation: currentGeneration,
        hostId,
        hostPublicKey,
        sessionId: bootstrap.sessionId,
        ticket: bootstrap.ticket,
        resumeToken: null,
        signalUrl: bootstrap.signalUrl,
        socket: null,
        signalLock: Semaphore.makeUnsafe(1),
        connectionId: null,
        connection: null,
        channels: {},
        decoders: {},
        channelLocks: {},
        identity,
        clientPublicKey,
        clientNonce: randomBase64Url(32),
        hostNonce: null,
        binding: null,
        authenticated: false,
        closed: false,
        reconnectAttempt: 0,
        reconnectTimer: null,
        turnRefreshTimer: null,
        turnRefreshDueAt: 0,
        iceServers: [],
        restartIceOnReady: false,
        lastEventSequence: 0,
        needsResync: false,
        connected: null,
        abort: new AbortController(),
        connectedTimer: null,
        disconnectedTimer: null,
        iceRecoveryTimer: null,
        waitingForHost: false,
        hostWaitTimer: null,
        signalReady: false,
        answeredRequest: false,
      };
      peer = state;
      const connected = Deferred.makeUnsafe<void, RemotePeerError>();
      state.connected = connected;
      try {
        openSignal(state, actions);
      } catch (error) {
        yield* failPeerEffect(state, error, actions);
      }
      yield* Deferred.await(connected);
    })();
  }

  function openSignal(state: PeerState, actions: ActionsRef): void {
    if (!active || state.closed || peer !== state || state.socket) return;
    if (Date.now() < signalRetryAt) {
      scheduleReconnect(state, actions);
      return;
    }
    if (!state.waitingForHost) armConnectedTimer(state, actions);
    const socket = new WebSocket(state.signalUrl);
    state.socket = socket;
    state.signalReady = false;
    socket.onopen = () => {
      if (state.closed || peer !== state || state.socket !== socket) return;
      diagnose(state, "signal-open");
      const hello: SignalClientMessage = {
        type: "hello",
        version: SIGNAL_PROTOCOL_VERSION,
        peer: "client",
        token: state.resumeToken ?? state.ticket,
        ...(options.waitForHost ? { waitForHost: true } : {}),
      };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = (event) => {
      if (!isString(event.data)) return;
      const data = event.data;
      void runPeerEffect(
        state.signalLock.withPermit(
          Effect.gen(function* () {
            // A frame still queued from a socket that `renewSignal` replaced belongs to a removed connection.
            if (state.closed || peer !== state || state.socket !== socket) return;
            let message: SignalServerMessage | null;
            try {
              message = decodeSignalServerMessage(JSON.parse(data));
            } catch (error) {
              // Where the two ends stop agreeing about the wire, and the service would send the same
              // bytes to the reconnect this would otherwise ask for. `protocol_error` is what lets a
              // consumer stop instead: every other failure here is a connection that a retry can fix,
              // and a caller cannot tell them apart from an `offline` update alone.
              return yield* failPeerEffect(state, error, actions, "protocol_error");
            }
            // A frame type this build does not know is a newer Signal service, not a broken connection.
            if (message) yield* handleSignal(state, message, actions);
          }),
        ),
      )
        // Only what handling a frame this peer did read can throw -- an ICE or SDP operation the
        // browser refused, or a host that said it went away. Those are connections failing.
        .catch((error) => {
          if (state.socket === socket) failPeer(state, error, actions);
        });
    };
    socket.onerror = () => socket.close();
    // The event is optional: a diagnostic that throws here would stop the reconnect.
    socket.onclose = (event?: CloseEvent) => {
      if (state.socket !== socket) return;
      state.socket = null;
      state.signalReady = false;
      if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
      state.hostWaitTimer = null;
      if (state.closed || peer !== state) return;
      if (event?.code === 1008) signalRetryAt = Date.now() + 60_000;
      diagnose(state, "signal-closed", `code ${event?.code ?? "unknown"}`);
      scheduleReconnect(state, actions);
    };
  }

  function handleSignal(state: PeerState, message: SignalServerMessage, actions: ActionsRef) {
    return Effect.fn("RemotePeer.handleSignal")(function* () {
      if (state.closed || peer !== state) return;
      // Webhook frames are for the desktop host's ingress socket, never for a team client.
      if (message.type === "webhook-ready" || message.type === "webhook-delivery") return;
      if (message.type === "account-profile-changed") {
        // Profile refresh failure must never break the RTC connection.
        yield* notify(peerCall(() => actions.current.onAccountProfileChanged?.()));
        return;
      }
      if (message.type === "account-servers-changed") {
        // A server list this phone cannot re-read must not break the connection the notice arrived
        // on either: that connection is to a server this phone already has.
        yield* notify(peerCall(() => actions.current.onAccountServersChanged?.()));
        return;
      }
      if (message.type === "error") {
        if (message.code === "rate_limited") {
          signalRetryAt = Date.now() + 60_000;
          state.socket?.close();
          return;
        }
        if (message.code === "session_revoked")
          return yield* failPeerEffect(state, new Error(message.message), actions, "session_revoked");
        return yield* new RemotePeerError({ message: message.message });
      }
      if (message.type === "host-waiting") {
        state.reconnectAttempt = 0;
        state.resumeToken = message.resumeToken;
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        state.hostWaitTimer = setTimeout(() => {
          state.hostWaitTimer = null;
          if (active && !state.closed && peer === state) renewSignal(state, actions);
        }, HOST_WAIT_RENEW_MS);
        // An authenticated peer keeps its path; only a new attempt waits without a deadline.
        if (state.waitingForHost || !state.connected) return;
        state.waitingForHost = true;
        if (state.connectedTimer !== null) clearTimeout(state.connectedTimer);
        state.connectedTimer = null;
        yield* notify(diagnosticCall(state, "host-waiting"));
        yield* notify(
          peerCall(() =>
            actions.current.onConnectionUpdate({
              hostId: state.hostId,
              state: "connecting",
              message: sourceText("error.remote.desktopOffline"),
              hostOffline: true,
            }),
          ),
        );
        return;
      }
      if (message.type === "ready") {
        state.reconnectAttempt = 0;
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        state.hostWaitTimer = null;
        if (state.waitingForHost) {
          state.waitingForHost = false;
          armConnectedTimer(state, actions);
        }
        // The host replaces a connection after 10 ICE restarts, so a socket that comes back while the
        // path is still online, such as on a return to the foreground, keeps the path. A TURN refresh
        // still restarts ICE, so a relayed path moves to the new credentials.
        const restartsIce = message.connectionId === null || state.restartIceOnReady || !isPeerOnline(state);
        state.restartIceOnReady = false;
        state.resumeToken = message.resumeToken;
        // Null on the `ready` that answers a TURN refresh: the credentials are new, the connection is
        // the one already open.
        state.connectionId = message.connectionId ?? state.connectionId;
        state.iceServers = message.iceServers;
        if (!state.connectionId || state.iceServers.length === 0)
          return yield* new RemotePeerError({ message: "Signal returned an incomplete connection." });
        const connectionId = state.connectionId;
        state.signalReady = true;
        yield* notify(diagnosticCall(state, "signal-ready", `${state.iceServers.length} ICE servers`));
        // A kept path still uses the credentials of its last ICE restart, so keep their deadline.
        if (state.connection && !restartsIce) resumeTurnRefresh(state);
        else scheduleTurnRefresh(state);
        if (state.connection) {
          const connection = state.connection;
          yield* peerDecode(() =>
            connection.setConfiguration({ iceServers: state.iceServers, bundlePolicy: "max-bundle" }),
          );
          if (restartsIce) yield* restartIce(state);
        }
        if (!state.connection) {
          const connection = yield* peerDecode(() => createPeerConnection(state, state.iceServers, actions));
          for (const kind of CHANNELS)
            bindChannel(state, kind, connection.createDataChannel(channelLabel(kind), { ordered: true }), actions);
          const offer = yield* peerCall(() => connection.createOffer());
          yield* peerCall(() => connection.setLocalDescription(offer));
          yield* peerDecode(() =>
            sendSignal(state, {
              type: "offer",
              version: SIGNAL_PROTOCOL_VERSION,
              connectionId,
              channel: "team",
              sdp: requiredSdp(offer),
            }),
          );
        }
        return;
      }
      if (message.type === "disconnect" && message.connectionId === state.connectionId) {
        failPeer(state, new Error(sourceText("error.remote.desktopOffline")), actions);
        return;
      }
      // `peer-ready`, `turn-refresh` and a `disconnect` for someone else carry nothing this peer acts
      // on; only the relayed negotiation does, and only on the team channel.
      if (message.type !== "answer" && message.type !== "ice-candidate" && message.type !== "ice-restart") return;
      if (message.channel !== "team" || message.connectionId !== state.connectionId) return;
      if (message.type === "answer") {
        const previousFingerprint = state.binding?.hostFingerprint;
        const nextFingerprint = message.sdp
          .match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/imu)?.[1]
          ?.trim()
          .toUpperCase();
        if (previousFingerprint && nextFingerprint !== previousFingerprint) {
          return yield* new RemotePeerError({ message: sourceText("error.remote.desktopRestarted") });
        }
        yield* peerCall(() => state.connection?.setRemoteDescription({ type: "answer", sdp: message.sdp }));
      } else if (message.type === "ice-candidate") {
        yield* peerCall(() =>
          state.connection?.addIceCandidate({
            candidate: message.candidate,
            sdpMid: message.sdpMid,
            sdpMLineIndex: message.sdpMLineIndex,
          }),
        );
      } else {
        yield* restartIce(state);
      }
    })();
  }

  function createPeerConnection(state: PeerState, iceServers: RTCIceServer[], actions: ActionsRef): RTCPeerConnection {
    const connection = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
    state.connection = connection;
    connection.onicecandidate = (event) => {
      // An empty candidate marks the end of gathering. Signal v1 accepts only candidates.
      if (!event.candidate?.candidate || !state.connectionId || !canSignal(state)) return;
      sendSignal(state, {
        type: "ice-candidate",
        version: SIGNAL_PROTOCOL_VERSION,
        connectionId: state.connectionId,
        channel: "team",
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };
    connection.ondatachannel = (event) => {
      const kind = channelKind(event.channel.label);
      if (kind) bindChannel(state, kind, event.channel, actions);
    };
    connection.onconnectionstatechange = () => {
      if (state.connection !== connection || state.closed || peer !== state) return;
      const connectionState = connection.connectionState;
      diagnose(state, "peer-state", connectionState);
      if (connectionState === "connected") void runPeerEffect(reportRoute(state, connection)).catch(() => undefined);
      // ICE can recover a network change without replacing the authenticated session. A failed
      // path waits for nothing: only an ICE restart can recover it.
      if (canRecoverPeer(state)) {
        recoverIce(state, actions, connectionState === "failed" ? 0 : ICE_RESTART_DELAY_MS);
        return;
      }
      if (connectionState === "disconnected") {
        scheduleDisconnectedCheck(state, actions);
        return;
      }
      if (connectionState === "connected") {
        if (state.disconnectedTimer !== null) clearTimeout(state.disconnectedTimer);
        if (state.iceRecoveryTimer !== null) clearTimeout(state.iceRecoveryTimer);
        state.disconnectedTimer = null;
        state.iceRecoveryTimer = null;
      }
      if (isPeerOnline(state)) {
        if (active && state.turnRefreshTimer === null) resumeTurnRefresh(state);
        settleConnected(state);
        resyncIfNeeded(state, actions);
      }
      if (connectionState === "failed" || connectionState === "closed") {
        failPeer(state, new Error(sourceText("error.remote.desktopOffline")), actions);
      }
    };
    return connection;
  }

  function bindChannel(state: PeerState, kind: ChannelKind, channel: RTCDataChannel, actions: ActionsRef): void {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    state.channels[kind] = channel;
    state.decoders[kind] = new TeamWebRtcPayloadDecoder();
    const lock = Semaphore.makeUnsafe(1);
    state.channelLocks[kind] = lock;
    channel.onopen = () => {
      if (CHANNELS.every((name) => state.channels[name]?.readyState === "open") && !state.binding) {
        diagnose(state, "channels-open");
        void runPeerEffect(beginAuthentication(state)).catch((error) => failPeer(state, error, actions));
      }
    };
    channel.onmessage = (event) => {
      const data = event.data;
      void runPeerEffect(
        lock.withPermit(
          Effect.gen(function* () {
            const decoded = yield* Effect.try({
              try: () => {
                if (!isString(data) && !(data instanceof ArrayBuffer)) {
                  throw new Error("The host sent unsupported binary data.");
                }
                return state.decoders[kind]?.push(data);
              },
              catch: peerError,
            });
            if (decoded !== undefined) yield* handleChannelData(state, kind, decoded, actions);
          }),
        ),
      ).catch((error) => failPeer(state, error, actions));
    };
    channel.onerror = () => failPeer(state, new Error(sourceText("error.remote.dataChannelFailed", { kind })), actions);
    channel.onclose = () => {
      if (state.authenticated) failPeer(state, new Error(sourceText("error.remote.desktopOffline")), actions);
    };
  }

  function beginAuthentication(state: PeerState) {
    return Effect.fn("RemotePeer.beginAuthentication")(function* () {
      const binding = {
        clientFingerprint: yield* peerDecode(() => descriptionFingerprint(state.connection?.localDescription ?? null)),
        hostFingerprint: yield* peerDecode(() => descriptionFingerprint(state.connection?.remoteDescription ?? null)),
      };
      state.binding = binding;
      const transcript = yield* peerDecode(() =>
        teamProtocolV2AuthenticationTranscript({
          hostId: state.hostId,
          sessionId: state.sessionId,
          ticket: state.ticket,
          clientPublicKey: state.clientPublicKey,
          clientNonce: state.clientNonce,
          clientFingerprint: binding.clientFingerprint,
          hostFingerprint: binding.hostFingerprint,
        }),
      );
      const signature = yield* signEd25519(new TextEncoder().encode(transcript), state.identity.secretKey);
      yield* sendPayload(
        state,
        "rpc",
        yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "auth-init",
            ticket: state.ticket,
            clientPublicKey: state.clientPublicKey,
            clientNonce: state.clientNonce,
            signature: bytesToBase64Url(signature),
          }),
        ),
      );
    })();
  }

  function handleChannelData(state: PeerState, kind: ChannelKind, data: string | ArrayBuffer, actions: ActionsRef) {
    return Effect.fn("RemotePeer.handleChannelData")(function* () {
      if (state.closed || peer !== state) return;
      if (kind === "desktop") {
        if (!state.authenticated)
          return yield* new RemotePeerError({ message: "The host sent stream data before authentication." });
        actions.current.onHostStreamData?.(data);
        return;
      }
      if (kind === "files") {
        if (!state.authenticated)
          return yield* new RemotePeerError({ message: sourceText("error.remote.dataBeforeAuth") });
        if (!(yield* downloads.receive(data)) && isString(data)) yield* peerDecode(() => files.receive(data));
        return;
      }
      if (!isString(data)) return;
      if (kind === "rpc" && !state.authenticated) {
        yield* handleAuthenticationFrameEffect(state, yield* peerDecode(() => decodeTeamProtocolV2AuthFrame(data)));
        return;
      }
      if (!state.authenticated)
        return yield* new RemotePeerError({ message: sourceText("error.remote.dataBeforeAuth") });
      if (kind === "rpc") {
        const frame = yield* peerDecode(() => decodeTeamProtocolV2RpcFrame(data));
        if (frame.type !== "response")
          return yield* new RemotePeerError({ message: "The host returned an invalid RPC frame." });
        state.answeredRequest = true;
        const pending = pendingRequests.get(frame.requestId);
        if (!pending) return;
        if ("error" in frame) pending.reject(new Error(frame.error.message));
        else if (!isDynamicRecord(frame.result) || !isNumber(frame.result.status) || !("body" in frame.result)) {
          pending.reject(new Error("The host returned an invalid response."));
        } else if (isDynamicRecord(frame.result.file) && isString(frame.result.file.transferId)) {
          // The RPC response arrived; the file receiver now owns the inactivity
          // deadline. A download failure rejects this request, not the peer.
          clearTimeout(pending.timer);
          const transferId = frame.result.file.transferId;
          const file = yield* downloads.take(transferId).pipe(Effect.result);
          if (Result.isSuccess(file)) pending.resolve({ status: frame.result.status, body: { ...file.success } });
          else pending.reject(file.failure);
        } else {
          const sideRoute = teamSideRouteCodec(pending.path);
          const status = frame.result.status;
          const body = frame.result.body;
          if (pending.method === "GET" && pending.path === TEAM_API_ROUTES.compatibility && status === 200) {
            state.hostProtocol = (yield* peerDecode(() => decodeTeamProtocolSupportV7Base(body))).protocol.maximum;
          }
          pending.resolve({
            status: frame.result.status,
            body: sideRoute
              ? yield* peerDecode(() => sideRoute.response(pending.path, status, body))
              : yield* peerDecode(() =>
                  decodeTeamProtocolV7WebRtcHttpResponse(pending.method, pending.path, status, body),
                ),
          });
        }
        // Keep the request registered until decoding succeeds, so failPeer can
        // reject the caller if a malformed response tears down the connection.
        clearTimeout(pending.timer);
        pendingRequests.delete(frame.requestId);
        return;
      }
      if (kind !== "events") return;
      const frame = yield* peerDecode(() => decodeTeamProtocolV2EventFrame(data));
      if (frame.type === "event-reset") {
        state.lastEventSequence = frame.nextSequence - 1;
        yield* RemotePeerIO.use((io) =>
          io.connectionUpdate({
            hostId: state.hostId,
            state: "online",
            message: null,
            resync: true,
          }),
        );
        yield* sendEventAckEffect(state);
        return;
      }
      if (frame.type !== "event")
        return yield* new RemotePeerError({ message: "The host returned an invalid event frame." });
      if (frame.sequence <= state.lastEventSequence) {
        yield* sendEventAckEffect(state);
        return;
      }
      if (frame.sequence !== state.lastEventSequence + 1)
        return yield* new RemotePeerError({ message: sourceText("error.remote.eventStreamGap") });
      const channel = yield* peerDecode(() => optionalTeamEvent(frame.payload));
      const decoded = channel
        ? { status: "known" as const, event: optionalTeamEventToCurrent(channel) }
        : yield* peerDecode(() => decodeTeamProtocolV7CurrentEvent(frame));
      if (decoded.status === "invalid")
        return yield* new RemotePeerError({ message: sourceText("error.remote.malformedEvent") });
      state.lastEventSequence = frame.sequence;
      if (decoded.status === "known") yield* RemotePeerIO.use((io) => io.teamEvent(state.hostId, decoded.event));
      yield* sendEventAckEffect(state);
    })();
  }

  function handleAuthenticationFrameEffect(state: PeerState, frame: TeamProtocolV2AuthFrame) {
    return Effect.fn("RemotePeer.handleAuthenticationFrame")(function* () {
      if (frame.type === "auth-ready") {
        if (!state.binding || frame.clientNonce !== state.clientNonce)
          return yield* new RemotePeerError({ message: "Host authentication did not match." });
        const binding = state.binding;
        const transcript = yield* peerDecode(() =>
          teamProtocolV2AuthenticationTranscript({
            hostId: state.hostId,
            sessionId: state.sessionId,
            ticket: state.ticket,
            clientPublicKey: state.clientPublicKey,
            clientNonce: state.clientNonce,
            hostNonce: frame.hostNonce,
            clientFingerprint: binding.clientFingerprint,
            hostFingerprint: binding.hostFingerprint,
          }),
        );
        const valid = yield* verifyEd25519Pem(
          yield* peerDecode(() => base64UrlToBytes(frame.signature)),
          new TextEncoder().encode(transcript),
          state.hostPublicKey,
        );
        if (state.closed || peer !== state) return;
        if (!valid)
          return yield* new RemotePeerError({ message: sourceText("error.remote.desktopIdentityNotVerified") });
        state.hostNonce = frame.hostNonce;
        yield* sendPayload(
          state,
          "rpc",
          yield* peerDecode(() =>
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "auth-complete",
              clientNonce: state.clientNonce,
              hostNonce: frame.hostNonce,
            }),
          ),
        );
        return;
      }
      if (
        frame.type !== "auth-confirmed" ||
        frame.clientNonce !== state.clientNonce ||
        frame.hostNonce !== state.hostNonce
      ) {
        return yield* new RemotePeerError({ message: "The desktop returned an invalid authentication confirmation." });
      }
      state.authenticated = true;
      yield* notify(diagnosticCall(state, "authenticated"));
      settleConnected(state);
      yield* sendEventAckEffect(state);
      yield* RemotePeerIO.use((io) => io.connectionUpdate({ hostId: state.hostId, state: "online", message: null }));
    })();
  }

  function requestEffect(
    method: string,
    path: string,
    body: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    onUploadProgress?: (sent: number, total: number) => void,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    return Effect.fn("RemotePeer.request")(function* () {
      const state = peer;
      if (!state || !isPeerOnline(state)) {
        if (state && (method === "GET" || method === "HEAD")) state.needsResync = true;
        return yield* new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") });
      }
      const delivery = upload && onUploadProgress ? trackUploadDelivery(state, onUploadProgress) : null;
      return yield* Effect.gen(function* () {
        const bodyTransferId = upload ? yield* files.upload(upload, delivery?.queued) : null;
        if (peer !== state || !isPeerOnline(state))
          return yield* new RemotePeerError({ message: sourceText("error.remote.attachmentConnectionChanged") });
        // Validate before registering a pending promise. A rejected local payload must not leave
        // an unobserved promise to reject again on timeout or disconnection.
        const sideRoute = teamSideRouteCodec(path);
        const payloadBody = upload
          ? null
          : sideRoute
            ? yield* peerDecode(() => sideRoute.request(path, body))
            : // A caller names a provider and model on agent creation only when the host advertises
              // `agent-create-model`, so the pair is kept whenever it is present.
              yield* peerDecode(() =>
                encodeTeamProtocolV7WebRtcHttpRequest(method, path, body, {
                  preserveSemanticTags: true,
                  agentCreateModel: true,
                }),
              );
        const requestId = createTeamRequestId((size) => crypto.getRandomValues(new Uint8Array(size)));
        const checksConnection = method === "GET" && path === TEAM_API_ROUTES.compatibility;
        const compatibilityTimeout = state.answeredRequest
          ? COMPATIBILITY_REQUEST_TIMEOUT_MS
          : FIRST_COMPATIBILITY_REQUEST_TIMEOUT_MS;
        const payload = yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "request",
            requestId,
            operation: "http.request",
            payload: {
              method,
              path,
              body: payloadBody,
              ...(bodyTransferId ? { bodyTransferId, contentType: upload?.mimeType } : {}),
              capabilities: [...teamCapabilitiesForProtocol(checksConnection ? undefined : state.hostProtocol)],
            },
          }),
        );
        const answer = Deferred.makeUnsafe<{ status: number; body: TeamProtocolV2Json }, RemotePeerError>();
        const response = yield* Effect.acquireUseRelease(
          // Registered before the send, so a fast response finds its request.
          Effect.sync(() => {
            const reject = (error: Error) => Deferred.doneUnsafe(answer, Effect.fail(peerError(error)));
            const timer = setTimeout(
              () => {
                pendingRequests.delete(requestId);
                const error = new Error(sourceText("error.remote.desktopRequestTimeout"));
                reject(error);
                if (checksConnection) failPeer(state, error, actions);
              },
              checksConnection ? Math.min(compatibilityTimeout, timeoutMs) : timeoutMs,
            );
            const resolve = (value: { status: number; body: TeamProtocolV2Json }) =>
              Deferred.doneUnsafe(answer, Effect.succeed(value));
            pendingRequests.set(requestId, { method, path, resolve, reject, timer });
            return timer;
          }),
          () =>
            // The frame is sent in the work scope: a request that stops waiting does not cut a frame.
            Effect.forkIn(
              sendPayload(state, "rpc", payload).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    const pending = pendingRequests.get(requestId);
                    if (pending) pending.reject(peerError(error));
                  }),
                ),
              ),
              workScope,
              { startImmediately: true },
            ).pipe(Effect.andThen(Deferred.await(answer))),
          (timer) =>
            Effect.sync(() => {
              clearTimeout(timer);
              pendingRequests.delete(requestId);
            }),
        );
        // A response confirms that the host has every uploaded byte.
        delivery?.complete();
        return response;
      }).pipe(Effect.ensuring(Effect.sync(() => delivery?.stop())));
    })();
  }

  /**
   * Upload progress as bytes that have left the phone. A chunk counts once the data channel has
   * sent it, not when it enters the channel's buffer: that buffer takes 4 MB before it pushes
   * back, so a photo would read as done the moment it was queued, and then wait at 100 %.
   */
  function trackUploadDelivery(state: PeerState, onProgress: (sent: number, total: number) => void) {
    let queued = 0;
    let total = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const report = () => {
      const buffered = state.channels.files?.bufferedAmount ?? 0;
      // The buffer also holds frame headers, so this can read a little low, never high.
      onProgress(Math.max(0, Math.min(total, queued - buffered)), total);
      if (buffered === 0 && queued >= total) stop();
    };
    return {
      queued(sent: number, size: number) {
        queued = sent;
        total = size;
        report();
        // Chunks stop arriving while the buffer drains, so read it until it is empty.
        timer ??= setInterval(report, 100);
      },
      complete() {
        stop();
        if (total > 0) onProgress(total, total);
      },
      stop,
    };
  }

  function sendEventAckEffect(state: PeerState) {
    return Effect.fn("RemotePeer.sendEventAck")(function* () {
      yield* sendPayload(
        state,
        "events",
        yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: state.lastEventSequence }),
        ),
      );
    })();
  }

  function sendEventControl(state: PeerState, control: TeamProtocolV1CurrentEventControl) {
    return Effect.fn("RemotePeer.sendEventControl")(function* () {
      yield* sendPayload(
        state,
        "events",
        yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "event-control",
            control: toWireTeamProtocolV1ClientEvent(control),
          }),
        ),
      );
    })();
  }

  function sendPayload(state: PeerState, kind: ChannelKind, data: string | ArrayBuffer) {
    return Effect.fn("RemotePeer.sendPayload")(function* () {
      const channel = state.channels[kind];
      if (channel?.readyState !== "open")
        return yield* new RemotePeerError({ message: sourceText("error.remote.channelNotOpen") });
      const maximumMessageSize = state.connection?.sctp?.maxMessageSize ?? Number.POSITIVE_INFINITY;
      for (const frame of yield* peerDecode(() => encodeTeamWebRtcPayload(data, maximumMessageSize))) {
        yield* waitForWritable(state, channel);
        yield* Effect.try({
          try: () => {
            if (frame instanceof ArrayBuffer) channel.send(frame);
            else channel.send(frame);
          },
          catch: (error) =>
            new RemotePeerError({
              message: error instanceof Error ? error.message : sourceText("error.remote.requestNotSent"),
            }),
        });
      }
    })();
  }

  function waitForWritable(state: PeerState, channel: RTCDataChannel) {
    return Effect.fn("RemotePeer.waitForWritable")(function* () {
      if (state.closed) return yield* new RemotePeerError({ message: sourceText("error.remote.serverDisconnected") });
      if (channel.bufferedAmount <= 4 * 1024 * 1024) return;
      return yield* Effect.callback<void, RemotePeerError>((resume) => {
        const onLow = () => resume(Effect.void);
        const onAbort = () =>
          resume(Effect.fail(new RemotePeerError({ message: sourceText("error.remote.serverDisconnected") })));
        state.abort.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(
          () =>
            resume(
              Effect.fail(
                new RemotePeerError({
                  message: sourceText("error.remote.channelBackpressure"),
                }),
              ),
            ),
          60_000,
        );
        channel.addEventListener("bufferedamountlow", onLow);
        if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) onLow();
        return Effect.sync(() => {
          clearTimeout(timer);
          channel.removeEventListener("bufferedamountlow", onLow);
          state.abort.signal.removeEventListener("abort", onAbort);
        });
      });
    })();
  }

  function restartIce(state: PeerState) {
    return Effect.fn("RemotePeer.restartIce")(function* () {
      const connection = state.connection;
      if (!connection || !state.connectionId) return;
      const connectionId = state.connectionId;
      yield* peerDecode(() => connection.restartIce());
      const offer = yield* peerCall(() => connection.createOffer({ iceRestart: true }));
      yield* peerCall(() => connection.setLocalDescription(offer));
      yield* peerDecode(() =>
        sendSignal(state, {
          type: "offer",
          version: SIGNAL_PROTOCOL_VERSION,
          connectionId,
          channel: "team",
          sdp: requiredSdp(offer),
        }),
      );
    })();
  }

  function canSignal(state: PeerState): boolean {
    return state.signalReady && state.socket?.readyState === WebSocket.OPEN;
  }

  function sendSignal(state: PeerState, message: SignalClientMessage): void {
    const socket = state.socket;
    if (!socket || !canSignal(state)) throw new Error(sourceText("error.remote.signalOffline"));
    socket.send(JSON.stringify(message));
  }

  function scheduleReconnect(state: PeerState, actions: ActionsRef): void {
    if (!active || state.reconnectTimer !== null) return;
    // The connection deadline measures an active attempt, not the service's rate-limit wait.
    if (Date.now() < signalRetryAt && state.connectedTimer !== null) {
      clearTimeout(state.connectedTimer);
      state.connectedTimer = null;
    }
    // A signaling-only interruption can resume inside Signal's grace window while
    // the data channels stay online. A peer that recovers its ICE path needs Signal
    // for the restart. The recovery owner replaces dead peers.
    const delay = Math.max(
      signalRetryAt - Date.now(),
      isPeerOnline(state) || canRecoverPeer(state) || state.waitingForHost
        ? Math.min(30_000, 500 * 2 ** state.reconnectAttempt++)
        : 60_000,
    );
    diagnose(state, "signal-retry", `in ${delay} ms`);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      openSignal(state, actions);
    }, delay);
  }

  /** Keeps the deadline from before background entry. A new 45-minute wait could pass the credentials' expiry. */
  function resumeTurnRefresh(state: PeerState): void {
    scheduleTurnRefresh(state, Math.max(0, state.turnRefreshDueAt - Date.now()));
  }

  function scheduleTurnRefresh(state: PeerState, delay = SIGNAL_TURN_REFRESH_INTERVAL_MS): void {
    if (!active || state.closed || peer !== state) return;
    state.turnRefreshDueAt = Date.now() + delay;
    armTurnRefresh(state, delay);
  }

  /** Keeps `turnRefreshDueAt`: until a `ready` answers, the path still uses the old credentials. */
  function armTurnRefresh(state: PeerState, delay: number): void {
    if (!active || state.closed || peer !== state) return;
    if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
    state.turnRefreshTimer = setTimeout(() => {
      state.turnRefreshTimer = null;
      if (canSignal(state)) {
        try {
          sendSignal(state, {
            type: "turn-refresh",
            version: SIGNAL_PROTOCOL_VERSION,
            connectionId: state.connectionId,
          });
        } catch {
          // The reconnect path will request fresh TURN credentials.
        }
      }
      armTurnRefresh(state, SIGNAL_TURN_REFRESH_INTERVAL_MS);
    }, delay);
  }

  function failPeer(
    state: PeerState,
    error: unknown,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ): void {
    if (state.closed || peer !== state) return;
    const message = failureMessage(error);
    diagnose(state, "failed", code ? `${code}: ${message}` : message);
    rejectConnection(state, new Error(message));
    void runPeerEffect(connectionOffline(state, message, actions, code));
    // A revoked session or a host that broke the protocol starts again from a new session.
    void runPeerEffect(closePeer(actions.current.endSession, code === undefined));
  }

  /** `failPeer` for Effect code: the same steps in the same order, its notices forked into the work scope. */
  function failPeerEffect(
    state: PeerState,
    error: unknown,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    return Effect.gen(function* () {
      if (state.closed || peer !== state) return;
      const message = failureMessage(error);
      yield* notify(diagnosticCall(state, "failed", code ? `${code}: ${message}` : message));
      rejectConnection(state, new Error(message));
      yield* notify(connectionOffline(state, message, actions, code));
      // A revoked session or a host that broke the protocol starts again from a new session.
      // Uninterruptible as the other close: `dispose` must not stop the session end it started.
      yield* Effect.forkIn(closePeer(actions.current.endSession, code === undefined).pipe(Effect.ignore), workScope, {
        startImmediately: true,
        uninterruptible: true,
      });
    });
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : sourceText("error.remote.webRtcConnectionFailed");
  }

  function connectionOffline(
    state: PeerState,
    message: string,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    return peerCall(() =>
      actions.current.onConnectionUpdate({
        hostId: state.hostId,
        state: "offline",
        message,
        ...(code ? { code } : {}),
      }),
    );
  }

  function rejectRequests(error: Error, readsOnly = false): void {
    for (const [id, pending] of pendingRequests) {
      if (readsOnly && pending.method !== "GET" && pending.method !== "HEAD") continue;
      pendingRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  function releaseRetainedSession(endSession: (sessionId: string) => Promise<void>, keepHostId?: string) {
    return Effect.fn("RemotePeer.releaseRetainedSession")(function* () {
      const retained = retainedSession;
      if (!retained || retained.hostId === keepHostId) return;
      retainedSession = null;
      yield* peerCall(() => endSession(retained.sessionId)).pipe(Effect.catch(() => Effect.void));
    })();
  }

  function closePeer(endSession: (sessionId: string) => Promise<void>, retainSession = false) {
    return Effect.fn("RemotePeer.closePeer")(function* () {
      files.cancel();
      downloads.clear();
      const state = peer;
      peer = null;
      generation += 1;
      if (!state) return;
      state.closed = true;
      state.abort.abort();
      if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
      if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
      if (state.connectedTimer !== null) clearTimeout(state.connectedTimer);
      if (state.disconnectedTimer !== null) clearTimeout(state.disconnectedTimer);
      if (state.iceRecoveryTimer !== null) clearTimeout(state.iceRecoveryTimer);
      if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
      state.socket?.close();
      state.connection?.close();
      for (const decoder of Object.values(state.decoders)) decoder?.reset();
      state.channelLocks = {};
      rejectRequests(new Error(sourceText("error.remote.serverDisconnected")));
      rejectConnection(state, new Error(sourceText("error.remote.serverDisconnected")));
      if (retainSession) {
        retainedSession = { hostId: state.hostId, sessionId: state.sessionId };
        return;
      }
      const previous = closingSessions.get(state.hostId);
      const cleanup = Deferred.makeUnsafe<void>();
      closingSessions.set(state.hostId, cleanup);
      yield* Effect.gen(function* () {
        if (previous) yield* Deferred.await(previous);
        yield* peerCall(() => endSession(state.sessionId)).pipe(Effect.catch(() => Effect.void));
      }).pipe(
        Effect.onExit((exit) =>
          Deferred.done(cleanup, exit).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (closingSessions.get(state.hostId) === cleanup) closingSessions.delete(state.hostId);
              }),
            ),
          ),
        ),
      );
    })();
  }

  /** The deadline of a connect attempt. It does not run while Signal holds the attempt for the host. */
  function armConnectedTimer(state: PeerState, actions: ActionsRef): void {
    if (!state.connected || state.connectedTimer !== null) return;
    state.connectedTimer = setTimeout(
      () => failPeer(state, new Error(sourceText("error.remote.desktopDidNotConnect")), actions),
      30_000,
    );
  }

  function settleConnected(state: PeerState): void {
    if (state.connectedTimer !== null) clearTimeout(state.connectedTimer);
    state.connectedTimer = null;
    if (state.connected) Deferred.doneUnsafe(state.connected, Effect.void);
    state.connected = null;
  }

  function rejectConnection(state: PeerState, error: Error): void {
    if (state.connectedTimer !== null) clearTimeout(state.connectedTimer);
    state.connectedTimer = null;
    if (state.connected) Deferred.doneUnsafe(state.connected, Effect.fail(peerError(error)));
    state.connected = null;
  }

  function channelLabel(kind: ChannelKind): string {
    if (kind === "desktop") return "openbot.remote-desktop.signal.v1";
    return TEAM_PROTOCOL_V2_CHANNELS[kind];
  }

  function channelKind(label: string): ChannelKind | null {
    if (label === TEAM_PROTOCOL_V2_CHANNELS.rpc) return "rpc";
    if (label === TEAM_PROTOCOL_V2_CHANNELS.events) return "events";
    if (label === TEAM_PROTOCOL_V2_CHANNELS.files) return "files";
    if (label === "openbot.remote-desktop.signal.v1") return "desktop";
    return null;
  }

  function descriptionFingerprint(description: RTCSessionDescription | null): string {
    const fingerprint = description?.sdp.match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/imu)?.[1]?.trim();
    if (!fingerprint) throw new Error("The WebRTC channel binding is unavailable.");
    return fingerprint.toUpperCase();
  }

  function requiredSdp(description: RTCSessionDescriptionInit): string {
    if (!description.sdp) throw new Error("WebRTC did not create a session description.");
    return description.sdp;
  }

  function randomBase64Url(size: number): string {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
  }
}
