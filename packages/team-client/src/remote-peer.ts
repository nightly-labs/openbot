import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_DEFAULT_RECONNECT_GRACE_MS,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_TURN_CREDENTIAL_TTL_SECONDS,
  SIGNAL_TURN_REFRESH_INTERVAL_MS,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
import { ticketNamesSignalHome } from "@openbot/contracts/signal-protocol/ticket";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeTeamProtocolSupportExpanded,
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2Json,
  decodeTeamProtocolV2RpcFrame,
  decodeTeamProtocolV8CurrentEvent,
  decodeTeamProtocolV10WebRtcHttpResponse,
  encodeTeamProtocolV2Frame,
  encodeTeamProtocolV9WebRtcHttpRequest,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_PROTOCOL_V2_CHANNELS,
  TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
  TEAM_PROTOCOL_V10,
  TEAM_WEBRTC_CLIENT_PROTOCOL,
  type TeamProtocolSupportV1,
  type TeamProtocolV2AuthFrame,
  type TeamProtocolV2Json,
  teamCapabilitiesForProtocol,
  teamCapabilityLists,
  teamProtocolV2AuthenticationTranscript,
  teamWebRtcClientProtocol,
} from "@openbot/contracts/team-protocol";
import type { LiveVoiceEvent } from "@openbot/contracts/team-protocol/live-voice-v1";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { addSkillSuggestionNames } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { addUiBlockAutoAnswers } from "@openbot/contracts/team-protocol/ui-block-auto-answer-v1";
import { addUiBlockLocationRequests } from "@openbot/contracts/team-protocol/ui-block-location-v1";
import { addUiBlockVaultRequests } from "@openbot/contracts/team-protocol/ui-block-vault-v1";
import {
  type TeamProtocolV1CurrentEventControl,
  toWireTeamProtocolV1ClientEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { sourceText } from "@openbot/i18n/source";
import { errorReference, referenceFrom } from "@openbot/user-errors/reference";
import { Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Result, Schema, Scope, Semaphore } from "effect";
import { base64ToBytes, base64UrlToBytes, bytesToBase64Url } from "./base64";
import { createEd25519Identity, type Ed25519Identity, signEd25519, verifyEd25519Pem } from "./ed25519";

class RemotePeerError extends Schema.TaggedError<RemotePeerError>()("RemotePeerError", {
  message: Schema.String,
  reference: Schema.optional(Schema.NullOr(Schema.String)),
}) {}
const failureReference = (error: unknown): string | null =>
  error instanceof RemotePeerError ? (error.reference ?? null) : errorReference(error);
const peerError = (error: unknown) =>
  error instanceof RemotePeerError
    ? error
    : new RemotePeerError({
        message: error instanceof Error ? error.message : sourceText("error.remote.operationFailed"),
        reference: failureReference(error),
      });
const referenced = (message: string, reference: string | null) => new RemotePeerError({ message, reference });

const SIGNAL_ERROR_TEXT = new Map<string, string>([
  ["authentication_required", sourceText("error.remote.ticketInvalidOrExpired")],
  ["invalid_message", sourceText("error.remote.signalInvalidMessage")],
  ["host_unavailable", sourceText("error.remote.hostOffline")],
  ["host_busy", sourceText("error.remote.hostBusy")],
  ["permission_denied", sourceText("error.remote.signalPermissionDenied")],
  ["protocol_error", sourceText("error.remote.signalProtocolError")],
]);
const SIGNAL_RATE_LIMIT_MS = 60_000;
const peerCall = <A>(operation: () => Promise<A> | A) =>
  Effect.tryPromise({ try: async () => operation(), catch: peerError });
const peerDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: peerError });
const deviceFileError = () => new FileTransferError({ message: sourceText("error.remote.attachmentChanged") });

import { createRemoteFileReceiver } from "./file-download";
import { createRemoteFileSender, FileTransferError, fileTransferError, type RemoteFileUpload } from "./file-upload";
import { markRemoteSync, type RemoteRequestProfile, startRemoteRequest } from "./sync-profile";

export type { RemoteFileUpload } from "./file-upload";
export { MOBILE_ATTACHMENT_BYTES } from "./file-upload";

import { iceCandidateRoute, iceServerErrorDetail } from "./ice-diagnostics";
import {
  judgePath,
  PATH_CHECK_INTERVAL_MS,
  type ProbeArm,
  type ProbeSample,
  unmeasuredProbeMs,
} from "./remote-path-check";
import { startRemoteRequestDeadline } from "./remote-recovery";
import { createTeamRequestId } from "./request-id";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./webrtc-framing";

export type RemoteTeamEvent = AgentEvent | TeamRealtimeEvent | LiveVoiceEvent;

export type RemoteLargeDownload = {
  maxBytes: number;
  mimeType?: string | undefined;
  file?: string | undefined;
};

export type RemoteTeamCommand =
  | { id: string; type: "connect"; hostId: string; hostPublicKey: string }
  | { id: string; type: "disconnect" }
  | {
      id: string;
      type: "request";
      method: string;
      path: string;
      body: TeamProtocolV2Json;
      upload?: RemoteFileUpload | undefined;
      timeoutMs?: number | undefined;
      largeDownload?: RemoteLargeDownload | undefined;
      downloadSize?: number | undefined;
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
  reference?: string;
  kept?: boolean;
}

export function createRemoteCommandMailbox(deliver: (command: RemoteTeamCommand) => void) {
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
        target = { hostId: command.hostId, hostPublicKey: command.hostPublicKey };
      }
      return new Promise((resolve) => {
        pending.set(command.id, { command, resolve });
        deliver(command);
      });
    },
    receive(result: RemoteTeamCommandResult) {
      const entry = pending.get(result.commandId);
      if (!entry) return;
      pending.delete(result.commandId);
      entry.resolve(result);
    },
    outstanding: (): RemoteTeamCommand[] => [...pending.values()].map((entry) => entry.command),
    dispose: cancel,
  };
}

function decodeRemoteFileUpload(value: unknown): RemoteFileUpload | null {
  if (!isDynamicRecord(value) || !isString(value.name) || !isString(value.mimeType) || !isString(value.base64))
    return null;
  const maxBytes = value.maxBytes;
  if (!(maxBytes === undefined || isNumber(maxBytes))) return null;
  const file = value.file;
  let source: RemoteFileUpload["file"];
  if (file !== undefined) {
    if (!isDynamicRecord(file)) return null;
    const { ref, size } = file;
    if (!isString(ref) || !isNumber(size)) return null;
    source = { ref, size };
  }
  return {
    name: value.name,
    mimeType: value.mimeType,
    base64: value.base64,
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(source === undefined ? {} : { file: source }),
  };
}

function decodeRemoteLargeDownload(value: unknown): RemoteLargeDownload | null {
  if (!isDynamicRecord(value) || !isNumber(value.maxBytes)) return null;
  if (!(value.mimeType === undefined || isString(value.mimeType))) return null;
  if (!(value.file === undefined || (isString(value.file) && value.file.length > 0))) return null;
  return {
    maxBytes: value.maxBytes,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }),
    ...(value.file === undefined ? {} : { file: value.file }),
  };
}

export function decodeRemoteTeamCommand(value: unknown): {
  command: RemoteTeamCommand | null;
  commandId: string | null;
} {
  if (!isDynamicRecord(value) || !isString(value.id)) return { command: null, commandId: null };
  const id = value.id;
  const invalid = { command: null, commandId: id };
  if (value.type === "disconnect") return { command: { id, type: "disconnect" }, commandId: id };
  if (value.type === "connect")
    return isString(value.hostId) && isString(value.hostPublicKey)
      ? { command: { id, type: "connect", hostId: value.hostId, hostPublicKey: value.hostPublicKey }, commandId: id }
      : invalid;
  if (value.type !== "request" || !isString(value.method) || !isString(value.path)) return invalid;
  const timeoutMs = value.timeoutMs;
  if (!(timeoutMs === undefined || isNumber(timeoutMs))) return invalid;
  const largeDownload = value.largeDownload === undefined ? undefined : decodeRemoteLargeDownload(value.largeDownload);
  if (largeDownload === null) return invalid;
  const upload = value.upload === undefined ? undefined : decodeRemoteFileUpload(value.upload);
  if (upload === null) return invalid;
  const downloadSize = value.downloadSize;
  if (!(downloadSize === undefined || (isNumber(downloadSize) && downloadSize > 0))) return invalid;
  let body: TeamProtocolV2Json;
  try {
    body = decodeTeamProtocolV2Json(value.body);
  } catch {
    return invalid;
  }
  return {
    command: {
      id,
      type: "request",
      method: value.method,
      path: value.path,
      body,
      ...(upload ? { upload } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(largeDownload ? { largeDownload } : {}),
      ...(downloadSize === undefined ? {} : { downloadSize }),
    },
    commandId: id,
  };
}

export interface RemoteTeamConnectionUpdate {
  hostId: string;
  state: "connecting" | "online" | "offline";
  message: string | null;
  code?: "protocol_error" | "session_revoked";
  reference?: string;
  resync?: boolean;
  hostOffline?: true;
  lostAfterMs?: number;
}

export interface RemoteTeamDiagnostic {
  hostId: string;
  step:
    | "signal-open"
    | "signal-closed"
    | "signal-ready"
    | "signal-retry"
    | "signal-moved"
    | "signal-error"
    | "host-waiting"
    | "path-check"
    | "event-reset"
    | "event-gap"
    | "resume"
    | "offer-sent"
    | "answer"
    | "peer-state"
    | "ice-state"
    | "ice-gathering"
    | "ice-candidate-error"
    | "route"
    | "ice-recovery"
    | "channels-open"
    | "authenticated"
    | "stalled"
    | "failed";
  detail?: string;
}

export interface RemoteUploadProgress {
  commandId: string;
  sent: number;
  total: number;
}

export interface RemoteDownloadWatch {
  size: number;
  onProgress: (received: number, total: number) => void;
}

export interface RemoteDownloadProgress {
  commandId: string;
  received: number;
  total: number;
}

export interface RemoteTeamPeerActions {
  onHostStreamData?: (data: string | ArrayBuffer) => void;
  onUploadProgress?: (progress: RemoteUploadProgress) => Promise<void>;
  onDownloadProgress?: (progress: RemoteDownloadProgress) => Promise<void>;
  onAccountProfileChanged?: () => Promise<void>;
  onAccountServersChanged?: () => Promise<void>;
  getBootstrap: (
    hostId: string,
    clientPublicKey: string,
    existingSessionId: string | null,
  ) => Promise<RemoteTeamBootstrapPayload>;
  endSession: (sessionId: string) => Promise<void>;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => Promise<void>;
  onDiagnostic?: (diagnostic: RemoteTeamDiagnostic) => Promise<void>;
  onNetworkRestored?: () => Promise<void>;
  onTeamEvent: (hostId: string, event: RemoteTeamEvent) => Promise<void>;
  digestUploadFile?: (ref: string) => Promise<string>;
  readUploadFile?: (part: { ref: string; offset: number; length: number }) => Promise<string>;
  writeDownloadFile?: (part: { ref: string; base64: string; append: boolean }) => Promise<void>;
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
  profile: RemoteRequestProfile | null;
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
  turnRefreshDueAt: number;
  iceServers: RTCIceServer[];
  restartIceOnReady: boolean;
  lastEventSequence: number;
  needsResync: boolean;
  connected: Deferred.Deferred<void, RemotePeerError> | null;
  readonly abort: AbortController;
  connectedTimer: ReturnType<typeof setTimeout> | null;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
  iceRecoveryTimer: ReturnType<typeof setTimeout> | null;
  waitingForHost: boolean;
  hostWaitTimer: ReturnType<typeof setTimeout> | null;
  failedOpens: number;
  signalAnswered: boolean;
  hostWaitingSince: number | null;
  hostWaitTicketMs: number;
  hostWaitTicketTimer: ReturnType<typeof setTimeout> | null;
  ticketRequest: boolean;
  signalReady: boolean;
  answeredRequest: boolean;
  probingPath: boolean;
  fullSnapshotRequested: boolean;
  lastAnswerAt: number;
  lastSignalClose: number | null;
  signalOpenedAt: number;
  offerSentAt: number | null;
  offerKind: "new connection" | "ICE restart" | null;
  localCandidates: Set<string>;
  remoteCandidates: Set<string>;
  hostProtocol: number | undefined;
  hostProtocolRead?: Deferred.Deferred<void>;
  iceRestarts: number;
  iceRestartSentAt: number | null;
  iceRestartAt: number | null;
  reconnectGraceMs: number;
  preparedSocket: WebSocket | null;
  offerPending: boolean;
  preparedAt: number;
  preparedIceServersAt: number;
}

const CHANNELS: ChannelKind[] = ["rpc", "events", "files", "desktop"];
const DISCONNECT_GRACE_MS = 15_000;
const ICE_RESTART_DELAY_MS = 2_000;
const ICE_RESTART_PROBE_MS = 6_000;
const SIGNAL_RENEW_DELAY_MS = 8_000;
const HOST_WAIT_RENEW_MS = 60_000;
const FAILED_OPENS_BEFORE_NEW_TICKET = 2;
const HOST_WAIT_TICKET_MS = 10_000;
const HOST_WAIT_TICKET_MAX_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000 + 30_000;
function signalRetryDelay(attempt: number): number {
  if (attempt === 0) return 500 + Math.random() * 3_500;
  return Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
}
const ICE_CONSENT_TIMEOUT_MS = 30_000;
const SIGNAL_IDLE_CLOSE_MS = 120_000;
const DEFAULT_RECONNECT_GRACE_MS = SIGNAL_DEFAULT_RECONNECT_GRACE_MS;
const SUSPEND_MARGIN_MS = 10_000;
export const REMOTE_PEER_LOST_AFTER_MS = SIGNAL_IDLE_CLOSE_MS + DEFAULT_RECONNECT_GRACE_MS + SUSPEND_MARGIN_MS;
function peerLostAfterMs(state: PeerState): number {
  return SIGNAL_IDLE_CLOSE_MS + state.reconnectGraceMs + SUSPEND_MARGIN_MS;
}
const HOST_ICE_RESTART_LIMIT = 10;
const ICE_SERVERS_REUSE_MS = (SIGNAL_TURN_CREDENTIAL_TTL_SECONDS * 1_000) / 2;
const PREPARED_CONNECTION_LIFETIME_MS = 5 * 60_000;

class RemotePeerIO extends Context.Service<
  RemotePeerIO,
  {
    bootstrap(
      hostId: string,
      publicKey: string,
      sessionId: string | null,
    ): Effect.Effect<RemoteTeamBootstrapPayload, RemotePeerError>;
    connectionUpdate(update: RemoteTeamConnectionUpdate): Effect.Effect<void, RemotePeerError>;
    teamEvent(hostId: string, event: RemoteTeamEvent): Effect.Effect<void, RemotePeerError>;
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
        teamEvent: Effect.fn("RemotePeerIO.teamEvent")((hostId: string, event: RemoteTeamEvent) =>
          peerCall(() => actions.current.onTeamEvent(hostId, event)),
        ),
      }),
    );
  }
}

export interface RemoteHostProtocols {
  get(hostId: string): number | undefined;
  set(hostId: string, protocol: number): void;
}

export function createRemoteTeamPeer(
  actions: ActionsRef,
  options: {
    waitForHost?: boolean;
    hostProtocols?: RemoteHostProtocols;
    clientProtocol?: TeamProtocolSupportV1["protocol"];
  } = {},
) {
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
  let waitForHost = options.waitForHost ?? false;
  let inactiveSince: number | null = null;
  let peer: PeerState | null = null;
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
    {
      digest: (ref) =>
        peerCall(() => {
          const digest = actions.current.digestUploadFile;
          if (!digest) throw new Error("This client cannot read device files.");
          return digest(ref);
        }).pipe(Effect.mapError(deviceFileError)),
      read: (ref, offset, length) =>
        peerCall(() => {
          const read = actions.current.readUploadFile;
          if (!read) throw new Error("This client cannot read device files.");
          return read({ ref, offset, length });
        }).pipe(
          Effect.flatMap((base64) => peerDecode(() => base64ToBytes(base64))),
          Effect.mapError(deviceFileError),
        ),
    },
  );
  const downloadTarget = (ref: string | undefined) => {
    const write = actions.current.writeDownloadFile;
    if (ref === undefined || !write) return undefined;
    return {
      ref,
      write: (base64: string, append: boolean) =>
        peerCall(() => write({ ref, base64, append })).pipe(Effect.mapError(fileTransferError)),
    };
  };
  const downloads = createRemoteFileReceiver((data) =>
    Effect.suspend(() => {
      const state = peer;
      if (!state || !isPeerOnline(state))
        return Effect.fail(new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") }));
      return sendPayload(state, "files", data);
    }),
  );
  const closingSessions = new Map<string, Deferred.Deferred<void>>();
  let retainedSession: { hostId: string; sessionId: string } | null = null;
  const hostProtocols: RemoteHostProtocols = options.hostProtocols ?? new Map<string, number>();
  const clientProtocol = options.clientProtocol ?? TEAM_WEBRTC_CLIENT_PROTOCOL;
  let lastSignal: { hostId: string; signalUrl: string; iceServers: RTCIceServer[]; at: number } | null = null;

  return {
    async sendHostStreamData(data: string | ArrayBuffer) {
      const state = peer;
      if (!state || !isPeerOnline(state)) throw new Error(sourceText("error.remote.hostConnectionOffline"));
      await runPeerEffect(sendPayload(state, "desktop", data));
    },
    cancelUpload: () => runPeerEffect(files.cancelUpload()),
    setTyping(agentId: string | null, typing: boolean) {
      const state = peer;
      if (!state || !isPeerOnline(state)) return;
      void runPeerEffect(sendEventControl(state, { type: "team-typing", agentId, typing })).catch(() => undefined);
    },
    execute: (command: RemoteTeamCommand) => runPeerEffect(executeCommand(command, actions)),
    setWaitForHost(value: boolean) {
      waitForHost = value;
    },
    dispose: async () => {
      active = false;
      await runPeerEffect(closePeer(actions.current.endSession));
      await runPeerEffect(releaseRetainedSession(actions.current.endSession));
      await Promise.allSettled([...running]);
      await runPeerEffect(Scope.close(workScope, Exit.void));
      await runtime.dispose();
    },
    setActive(value: boolean) {
      const now = Date.now();
      const away = value && !active && inactiveSince !== null ? now - inactiveSince : 0;
      if (!value && active) inactiveSince = now;
      if (value) inactiveSince = null;
      active = value;
      const state = peer;
      if (!state) return;
      if (!active) {
        if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
        if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
        if (state.disconnectedTimer !== null) clearTimeout(state.disconnectedTimer);
        if (state.iceRecoveryTimer !== null) clearTimeout(state.iceRecoveryTimer);
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        if (state.hostWaitTicketTimer !== null) clearTimeout(state.hostWaitTicketTimer);
        state.hostWaitTimer = null;
        state.hostWaitTicketTimer = null;
        state.disconnectedTimer = null;
        state.iceRecoveryTimer = null;
        state.reconnectTimer = null;
        state.turnRefreshTimer = null;
        state.needsResync ||= [...pendingRequests.values()].some(
          (request) => request.method === "GET" || request.method === "HEAD",
        );
        rejectRequests(new Error(sourceText("error.remote.appInBackground")), true);
        if (!state.authenticated) failPeer(state, new Error(sourceText("error.remote.appInBackground")), actions);
      } else {
        const resumed = (decision: string) =>
          diagnose(
            state,
            "resume",
            `away ${Math.round(away / 1000)} s, ${state.connection?.connectionState ?? "no connection"}, ${decision}`,
          );
        if (away >= peerLostAfterMs(state) && state.authenticated) {
          resumed("replace connection");
          void runPeerEffect(closePeer(actions.current.endSession, true));
        } else if (canRecoverPeer(state)) {
          resumed("recover ICE");
          recoverIce(state, actions, 0);
        } else if (!isPeerOnline(state)) {
          resumed(state.authenticated ? "connect again" : "attempt not finished");
          failPeer(state, new Error(sourceText("error.remote.desktopRestoreNeeded")), actions);
        } else {
          resumeTurnRefresh(state);
          resumed(
            away >= ICE_CONSENT_TIMEOUT_MS ? "renew Signal" : state.socket ? "keep path and Signal" : "open Signal",
          );
          if (away >= ICE_CONSENT_TIMEOUT_MS) renewSignal(state, actions);
          else if (!state.socket) openSignal(state, actions);
        }
      }
    },
    networkRestored() {
      const state = peer;
      if (active && state && !state.closed && (state.authenticated || state.waitingForHost))
        renewSignal(state, actions);
      void runPeerEffect(peerCall(() => actions.current.onNetworkRestored?.())).catch(() => undefined);
    },
    eventsFailed() {
      const state = peer;
      if (state && !state.closed)
        failPeer(state, referenced(sourceText("error.remote.connectionDropped"), "events/failed"), actions);
    },
    networkMoved() {
      const state = peer;
      if (active && state && !state.closed)
        failPeer(state, referenced(sourceText("error.remote.connectionDropped"), "network/moved"), actions);
      void runPeerEffect(peerCall(() => actions.current.onNetworkRestored?.())).catch(() => undefined);
    },
  };
  function diagnosticCall(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string) {
    markRemoteSync(`peer:${step}`);
    const diagnostic: RemoteTeamDiagnostic = { hostId: state.hostId, step, ...(detail ? { detail } : {}) };
    return peerCall(() => actions.current.onDiagnostic?.(diagnostic));
  }

  function diagnose(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string): void {
    void runPeerEffect(diagnosticCall(state, step, detail)).catch(() => undefined);
  }

  function notify<A, E>(operation: Effect.Effect<A, E, RemotePeerIO>) {
    return Effect.forkIn(operation.pipe(Effect.ignore), workScope, { startImmediately: true });
  }

  function reportRoute(state: PeerState, connection: RTCPeerConnection) {
    return Effect.fn("RemotePeer.reportRoute")(function* () {
      const pair = selectedCandidates(yield* peerCall(() => connection.getStats()));
      if (pair) yield* notify(diagnosticCall(state, "route", iceCandidateRoute(pair.local, pair.remote)));
    })();
  }

  function selectedPair(stats: RTCStatsReport) {
    const reports = [...stats.values()];
    const transport = reports.find((report) => report.type === "transport" && report.selectedCandidatePairId);
    return (
      (transport ? stats.get(transport.selectedCandidatePairId) : undefined) ??
      reports.find((report) => report.type === "candidate-pair" && report.state === "succeeded" && report.nominated)
    );
  }

  function selectedCandidates(stats: RTCStatsReport) {
    const pair = selectedPair(stats);
    return pair ? { local: stats.get(pair.localCandidateId), remote: stats.get(pair.remoteCandidateId) } : null;
  }

  function sentOnPath(connection: RTCPeerConnection) {
    return peerCall(() => connection.getStats()).pipe(
      Effect.map((stats) => {
        const pair = selectedPair(stats);
        if (!pair) return null;
        const rtt = Number(pair.currentRoundTripTime);
        return {
          bytesSent: Number(pair.bytesSent) || 0,
          bytesReceived: Number(pair.bytesReceived) || 0,
          rttMs: Number.isFinite(rtt) ? rtt * 1000 : null,
        };
      }),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  function usesRelay(connection: RTCPeerConnection) {
    return peerCall(() => connection.getStats()).pipe(
      Effect.map((stats) => {
        const pair = selectedCandidates(stats);
        return !pair || pair.local?.candidateType === "relay" || pair.remote?.candidateType === "relay";
      }),
      Effect.catch(() => Effect.succeed(true)),
    );
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
    return (
      state.authenticated &&
      (connectionState === "disconnected" || connectionState === "failed" || connectionState === "connecting") &&
      CHANNELS.every((kind) => state.channels[kind]?.readyState === "open")
    );
  }

  function recoverIce(state: PeerState, actions: ActionsRef, delay: number): void {
    scheduleDisconnectedCheck(state, actions);
    if (!active || state.iceRecoveryTimer !== null) return;
    diagnose(state, "ice-recovery", `in ${delay} ms`);
    const canContinue = () => active && !state.closed && peer === state && state.authenticated && !isPeerOnline(state);
    state.iceRecoveryTimer = setTimeout(() => {
      state.iceRecoveryTimer = null;
      if (!canContinue()) return;
      const restartRunning =
        state.iceRestartSentAt !== null && Date.now() - state.iceRestartSentAt < SIGNAL_RENEW_DELAY_MS;
      if (canSignal(state)) {
        if (!restartRunning) void runPeerEffect(restartIce(state)).catch(() => undefined);
      } else if (!state.socket) renewSignal(state, actions);
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
    state.iceRestartAt = Date.now();
    state.socket = null;
    socket?.close();
    reopenSignal(state, actions);
  }

  function reopenSignal(state: PeerState, actions: ActionsRef): void {
    const hostWait = state.hostWaitingSince !== null && Date.now() - state.hostWaitingSince >= state.hostWaitTicketMs;
    const failedHome = state.failedOpens >= FAILED_OPENS_BEFORE_NEW_TICKET && ticketNamesSignalHome(state.ticket);
    if (failedHome || hostWait) void runPeerEffect(followHost(state, actions)).catch(() => undefined);
    else openSignal(state, actions);
  }

  function followHost(state: PeerState, actions: ActionsRef) {
    return Effect.fn("RemotePeer.followHost")(function* () {
      if (state.ticketRequest || state.closed || peer !== state) return;
      state.ticketRequest = true;
      state.failedOpens = 0;
      const waiting = state.hostWaitingSince !== null;
      if (waiting) {
        state.hostWaitingSince = Date.now();
        state.hostWaitTicketMs = Math.min(state.hostWaitTicketMs * 2, HOST_WAIT_TICKET_MAX_MS);
      }
      const result = yield* RemotePeerIO.use((io) =>
        io.bootstrap(state.hostId, state.clientPublicKey, state.sessionId),
      ).pipe(
        Effect.result,
        Effect.ensuring(
          Effect.sync(() => {
            state.ticketRequest = false;
          }),
        ),
      );
      if (state.closed || peer !== state) {
        if (Result.isSuccess(result) && result.success.sessionId !== state.sessionId)
          yield* notify(peerCall(() => actions.current.endSession(result.success.sessionId)));
        return;
      }
      let moved = false;
      if (Result.isSuccess(result)) {
        const bootstrap = result.success;
        if (bootstrap.sessionId !== state.sessionId)
          yield* notify(peerCall(() => actions.current.endSession(bootstrap.sessionId)));
        else {
          moved = bootstrap.signalUrl !== state.signalUrl;
          state.ticket = bootstrap.ticket;
          if (moved) {
            state.signalUrl = bootstrap.signalUrl;
            state.resumeToken = null;
            state.hostWaitingSince = null;
            state.hostWaitTicketMs = HOST_WAIT_TICKET_MS;
            if (state.hostWaitTicketTimer !== null) clearTimeout(state.hostWaitTicketTimer);
            state.hostWaitTicketTimer = null;
            yield* notify(diagnosticCall(state, "signal-moved", waiting ? "host waiting" : "failed opens"));
          }
        }
      }
      if (!active) return;
      if (moved && state.socket) renewSignal(state, actions);
      else if (!state.socket && state.reconnectTimer === null) openSignal(state, actions);
    })();
  }

  function scheduleDisconnectedCheck(state: PeerState, actions: ActionsRef): void {
    if (!active || state.disconnectedTimer !== null) return;
    state.disconnectedTimer = setTimeout(() => {
      state.disconnectedTimer = null;
      if (isPeerOnline(state)) return;
      diagnose(state, "stalled", `ICE grace end: ${connectionSnapshot(state)}`);
      failPeer(state, iceFailure(state.connection?.connectionState), actions);
    }, DISCONNECT_GRACE_MS);
  }

  function keepsReads(state: PeerState): boolean {
    const keeps = !state.needsResync;
    state.needsResync = false;
    return keeps;
  }

  function resyncIfNeeded(state: PeerState, actions: ActionsRef): void {
    if (!active || !isPeerOnline(state) || !state.needsResync) return;
    state.needsResync = false;
    void runPeerEffect(
      peerCall(() =>
        actions.current.onConnectionUpdate({
          hostId: state.hostId,
          state: "online",
          message: null,
          resync: true,
          lostAfterMs: peerLostAfterMs(state),
        }),
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
              const waiting = peer;
              const authenticated = waiting.authenticated;
              yield* Deferred.await(connected);
              return { commandId: command.id, ok: true, kept: authenticated && keepsReads(waiting) };
            }
          }
          if (
            peer &&
            isPeerOnline(peer) &&
            peer.hostId === command.hostId &&
            peer.hostPublicKey === command.hostPublicKey
          ) {
            return { commandId: command.id, ok: true, kept: keepsReads(peer) };
          }
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
        let downloaded = -1;
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
          command.largeDownload,
          command.downloadSize === undefined
            ? undefined
            : {
                size: command.downloadSize,
                onProgress: (received, total) => {
                  const percent = total > 0 ? Math.floor((received / total) * 100) : 100;
                  if (percent === downloaded) return;
                  downloaded = percent;
                  void runPeerEffect(
                    peerCall(() => actions.current.onDownloadProgress?.({ commandId: command.id, received, total })),
                  ).catch(() => undefined);
                },
              },
        );
        return { commandId: command.id, ok: true, status: response.status, body: response.body };
      }).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure;
      {
        const message = error.message;
        const reference = failureReference(error);
        const referenceField = reference ? { reference } : {};
        if (command.type === "connect" && commandGeneration === generation) {
          yield* RemotePeerIO.use((io) =>
            io.connectionUpdate({ hostId: command.hostId, state: "offline", message, ...referenceField }),
          );
        }
        return {
          commandId: command.id,
          ok: false,
          error: message,
          ...referenceField,
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
      while (closingSessions.has(hostId)) {
        const closing = closingSessions.get(hostId);
        if (closing) yield* Deferred.await(closing);
      }
      if (currentGeneration !== generation || !active)
        return yield* new RemotePeerError({ message: sourceText("error.remote.connectionReplaced") });
      const clientPublicKey = identity.publicKeyPem;
      const existingSessionId = retainedSession?.hostId === hostId ? retainedSession.sessionId : null;
      yield* Effect.forkIn(releaseRetainedSession(actions.current.endSession, hostId), workScope, {
        startImmediately: true,
        uninterruptible: true,
      });
      const known = lastSignal?.hostId === hostId ? lastSignal : null;
      const preparedSocket = known && Date.now() >= signalRetryAt ? prepareSignalSocket(known.signalUrl) : null;
      const bootstrap = yield* RemotePeerIO.use((io) => io.bootstrap(hostId, clientPublicKey, existingSessionId)).pipe(
        Effect.tapError(() => Effect.sync(() => preparedSocket?.close())),
      );
      if (retainedSession?.sessionId === existingSessionId) retainedSession = null;
      if (currentGeneration !== generation || !active) {
        preparedSocket?.close();
        yield* peerCall(() => actions.current.endSession(bootstrap.sessionId)).pipe(Effect.catch(() => Effect.void));
        return yield* new RemotePeerError({ message: sourceText("error.remote.connectionReplaced") });
      }
      const usableSocket = preparedSocket && known?.signalUrl === bootstrap.signalUrl ? preparedSocket : null;
      if (preparedSocket && !usableSocket) preparedSocket.close();
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
        failedOpens: 0,
        signalAnswered: false,
        hostWaitingSince: null,
        hostWaitTicketMs: HOST_WAIT_TICKET_MS,
        hostWaitTicketTimer: null,
        ticketRequest: false,
        signalReady: false,
        answeredRequest: false,
        probingPath: false,
        fullSnapshotRequested: false,
        lastAnswerAt: 0,
        lastSignalClose: null,
        signalOpenedAt: 0,
        offerSentAt: null,
        offerKind: null,
        localCandidates: new Set(),
        remoteCandidates: new Set(),
        hostProtocol: hostProtocols.get(hostId),
        iceRestarts: 0,
        iceRestartSentAt: null,
        iceRestartAt: null,
        reconnectGraceMs: DEFAULT_RECONNECT_GRACE_MS,
        preparedSocket: usableSocket,
        offerPending: false,
        preparedAt: 0,
        preparedIceServersAt: 0,
      };
      peer = state;
      const connected = Deferred.makeUnsafe<void, RemotePeerError>();
      state.connected = connected;
      if (known && known.signalUrl === bootstrap.signalUrl && Date.now() - known.at < ICE_SERVERS_REUSE_MS)
        yield* Effect.forkIn(
          state.signalLock
            .withPermit(prepareConnection(state, known.iceServers, known.at, actions))
            .pipe(Effect.ignore),
          workScope,
          { startImmediately: true },
        );
      try {
        openSignal(state, actions);
      } catch (error) {
        yield* failPeerEffect(state, error, actions);
      }
      yield* Deferred.await(connected);
    })();
  }

  function prepareSignalSocket(signalUrl: string): WebSocket | null {
    try {
      const socket = new WebSocket(signalUrl);
      socket.onerror = () => socket.close();
      return socket;
    } catch {
      return null;
    }
  }

  function prepareConnection(state: PeerState, iceServers: RTCIceServer[], iceServersAt: number, actions: ActionsRef) {
    return Effect.fn("RemotePeer.prepareConnection")(function* () {
      if (state.closed || peer !== state || state.connection) return;
      const connection = yield* peerDecode(() => createPeerConnection(state, iceServers, actions));
      state.offerPending = true;
      state.preparedAt = Date.now();
      state.preparedIceServersAt = iceServersAt;
      for (const kind of CHANNELS)
        bindChannel(state, kind, connection.createDataChannel(channelLabel(kind), { ordered: true }), actions);
      yield* Effect.gen(function* () {
        const offer = yield* peerCall(() => connection.createOffer());
        yield* peerCall(() => connection.setLocalDescription(offer));
      }).pipe(Effect.tapError(() => Effect.sync(() => discardPreparedConnection(state))));
    })();
  }

  function discardPreparedConnection(state: PeerState): void {
    if (!state.offerPending) return;
    const connection = state.connection;
    state.offerPending = false;
    state.connection = null;
    state.channels = {};
    state.decoders = {};
    state.localCandidates.clear();
    connection?.close();
  }

  function openSignal(state: PeerState, actions: ActionsRef): void {
    const prepared = state.preparedSocket;
    state.preparedSocket = null;
    if (!active || state.closed || peer !== state || state.socket) {
      prepared?.close();
      return;
    }
    if (Date.now() < signalRetryAt) {
      prepared?.close();
      scheduleReconnect(state, actions);
      return;
    }
    if (!state.waitingForHost) armConnectedTimer(state, actions);
    const reusable = prepared !== null && prepared.readyState <= WebSocket.OPEN;
    if (prepared && !reusable) prepared.close();
    const socket = reusable ? prepared : new WebSocket(state.signalUrl);
    state.socket = socket;
    state.signalReady = false;
    state.signalAnswered = false;
    state.signalOpenedAt = 0;
    let refusal: string | null = null;
    const opened = () => {
      if (state.closed || peer !== state || state.socket !== socket) return;
      state.signalOpenedAt = Date.now();
      diagnose(
        state,
        "signal-open",
        `${state.resumeToken ? "resume" : "ticket"}${waitForHost ? ", wait for host" : ""}`,
      );
      const hello: SignalClientMessage = {
        type: "hello",
        version: SIGNAL_PROTOCOL_VERSION,
        peer: "client",
        token: state.resumeToken ?? state.ticket,
        ...(waitForHost ? { waitForHost: true } : {}),
      };
      socket.send(JSON.stringify(hello));
    };
    socket.onopen = opened;
    if (socket.readyState === WebSocket.OPEN) opened();
    socket.onmessage = (event) => {
      if (!isString(event.data)) return;
      const data = event.data;
      refusal = signalErrorCode(data) ?? refusal;
      void runPeerEffect(
        state.signalLock.withPermit(
          Effect.gen(function* () {
            if (state.closed || peer !== state || state.socket !== socket) return;
            let message: SignalServerMessage | null;
            try {
              message = decodeSignalServerMessage(JSON.parse(data));
            } catch (error) {
              return yield* failPeerEffect(state, error, actions, "protocol_error");
            }
            if (message) yield* handleSignal(state, message, actions);
          }),
        ),
      ).catch((error) => {
        if (state.socket === socket) failPeer(state, error, actions);
      });
    };
    socket.onerror = () => socket.close();
    socket.onclose = (event?: CloseEvent) => {
      if (state.socket !== socket) return;
      state.socket = null;
      state.signalReady = false;
      if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
      state.hostWaitTimer = null;
      if (state.closed || peer !== state) return;
      if (!state.signalAnswered) state.failedOpens += 1;
      if (event) state.lastSignalClose = event.code;
      if (event?.code === 1008 && (refusal === null || refusal === "rate_limited"))
        signalRetryAt = Date.now() + SIGNAL_RATE_LIMIT_MS;
      diagnose(
        state,
        "signal-closed",
        `code ${event?.code ?? "unknown"}${state.signalAnswered ? "" : state.signalOpenedAt ? `, no answer after ${Date.now() - state.signalOpenedAt} ms` : ", not opened"}`,
      );
      const refused = refusal === null ? sourceText("error.remote.signalClosed") : SIGNAL_ERROR_TEXT.get(refusal);
      if (
        refused !== undefined &&
        !state.authenticated &&
        state.connected &&
        !state.waitingForHost &&
        Date.now() >= signalRetryAt
      ) {
        const reference =
          refusal === null ? referenceFrom("signal", "close", event?.code) : referenceFrom("signal", refusal);
        failPeer(state, referenced(refused, reference), actions);
        return;
      }
      scheduleReconnect(state, actions);
    };
  }

  function handleSignal(state: PeerState, message: SignalServerMessage, actions: ActionsRef) {
    return Effect.fn("RemotePeer.handleSignal")(function* () {
      if (state.closed || peer !== state) return;
      if (
        message.type === "webhook-ready" ||
        message.type === "webhook-delivery" ||
        message.type === "github-ready" ||
        message.type === "github-delivery"
      )
        return;
      if (message.type === "account-profile-changed") {
        yield* notify(peerCall(() => actions.current.onAccountProfileChanged?.()));
        return;
      }
      if (message.type === "account-servers-changed") {
        yield* notify(peerCall(() => actions.current.onAccountServersChanged?.()));
        return;
      }
      if (message.type === "error") {
        const reference = referenceFrom("signal", message.code);
        yield* notify(diagnosticCall(state, "signal-error", message.code));
        if (message.code === "rate_limited") {
          signalRetryAt = Date.now() + SIGNAL_RATE_LIMIT_MS;
          state.socket?.close();
          if (!state.authenticated) {
            yield* notify(
              peerCall(() =>
                actions.current.onConnectionUpdate({
                  hostId: state.hostId,
                  state: "connecting",
                  message: sourceText("error.remote.signalRateLimited", { seconds: SIGNAL_RATE_LIMIT_MS / 1000 }),
                  ...(reference ? { reference } : {}),
                }),
              ),
            );
          }
          return;
        }
        if (message.code === "session_revoked")
          return yield* failPeerEffect(state, referenced(message.message, reference), actions, "session_revoked");
        const text = SIGNAL_ERROR_TEXT.get(message.code) ?? sourceText("error.remote.signalRefused");
        return yield* referenced(text, reference);
      }
      if (message.type === "host-waiting") {
        state.reconnectAttempt = 0;
        state.failedOpens = 0;
        state.signalAnswered = true;
        state.resumeToken = message.resumeToken;
        if (state.hostWaitingSince === null) {
          state.hostWaitingSince = Date.now();
          state.hostWaitTicketTimer = setTimeout(() => {
            state.hostWaitTicketTimer = null;
            if (active && !state.closed && peer === state && state.hostWaitingSince !== null)
              void runPeerEffect(followHost(state, actions)).catch(() => undefined);
          }, HOST_WAIT_TICKET_MS);
        }
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        state.hostWaitTimer = setTimeout(() => {
          state.hostWaitTimer = null;
          if (active && !state.closed && peer === state) renewSignal(state, actions);
        }, HOST_WAIT_RENEW_MS);
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
        state.failedOpens = 0;
        state.signalAnswered = true;
        state.hostWaitingSince = null;
        state.hostWaitTicketMs = HOST_WAIT_TICKET_MS;
        if (state.hostWaitTimer !== null) clearTimeout(state.hostWaitTimer);
        if (state.hostWaitTicketTimer !== null) clearTimeout(state.hostWaitTicketTimer);
        state.hostWaitTimer = null;
        state.hostWaitTicketTimer = null;
        if (state.waitingForHost) {
          state.waitingForHost = false;
          armConnectedTimer(state, actions);
        }
        const turnRefresh = message.connectionId === null;
        if (state.offerPending && Date.now() - state.preparedAt > PREPARED_CONNECTION_LIFETIME_MS)
          discardPreparedConnection(state);
        const online = isPeerOnline(state);
        const relayed = turnRefresh && online && state.connection ? yield* usesRelay(state.connection) : false;
        const restartsIce = state.restartIceOnReady || !online || relayed;
        state.restartIceOnReady = false;
        state.resumeToken = message.resumeToken;
        state.connectionId = message.connectionId ?? state.connectionId;
        state.iceServers = message.iceServers;
        if (!turnRefresh) state.reconnectGraceMs = message.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
        if (!state.connectionId)
          return yield* new RemotePeerError({ message: "Signal returned an incomplete connection." });
        if (state.iceServers.length === 0)
          return yield* referenced(sourceText("error.remote.relayUnavailable"), "signal/no_ice_servers");
        lastSignal = { hostId: state.hostId, signalUrl: state.signalUrl, iceServers: state.iceServers, at: Date.now() };
        const connectionId = state.connectionId;
        state.signalReady = true;
        const preparedConnection = state.offerPending ? state.connection : null;
        if (preparedConnection) {
          const sdp = preparedConnection.localDescription?.sdp;
          if (!sdp) discardPreparedConnection(state);
          else {
            state.offerPending = false;
            yield* peerDecode(() =>
              preparedConnection.setConfiguration({ iceServers: state.iceServers, bundlePolicy: "max-bundle" }),
            );
            yield* peerDecode(() =>
              sendSignal(state, {
                type: "offer",
                version: SIGNAL_PROTOCOL_VERSION,
                connectionId,
                channel: "team",
                sdp,
              }),
            );
            state.offerSentAt = Date.now();
            state.offerKind = "new connection";
            yield* notify(
              diagnosticCall(
                state,
                "offer-sent",
                `new connection, made ${state.offerSentAt - state.preparedAt} ms before, ${candidateCounts(state.localCandidates)}`,
              ),
            );
            yield* notify(diagnosticCall(state, "signal-ready", `${state.iceServers.length} ICE servers`));
            scheduleTurnRefresh(
              state,
              Math.max(0, state.preparedIceServersAt + SIGNAL_TURN_REFRESH_INTERVAL_MS - Date.now()),
            );
            return;
          }
        }
        yield* notify(
          diagnosticCall(
            state,
            "signal-ready",
            `${state.iceServers.length} ICE servers${turnRefresh ? ", TURN refresh" : `, ${Date.now() - state.signalOpenedAt} ms after open`}`,
          ),
        );
        if (state.connection && !restartsIce && !turnRefresh) resumeTurnRefresh(state);
        else scheduleTurnRefresh(state);
        if (state.connection) {
          const connection = state.connection;
          yield* peerDecode(() =>
            connection.setConfiguration({ iceServers: state.iceServers, bundlePolicy: "max-bundle" }),
          );
          if (restartsIce) yield* restartIce(state);
        }
        if (!state.connection) {
          const startedAt = Date.now();
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
          state.offerSentAt = Date.now();
          state.offerKind = "new connection";
          yield* notify(
            diagnosticCall(state, "offer-sent", `new connection, made in ${state.offerSentAt - startedAt} ms`),
          );
        }
        return;
      }
      if (message.type === "disconnect" && message.connectionId === state.connectionId) {
        failPeer(state, referenced(sourceText("error.remote.desktopOffline"), "signal/disconnect"), actions);
        return;
      }
      if (message.type !== "answer" && message.type !== "ice-candidate" && message.type !== "ice-restart") return;
      if (message.channel !== "team" || message.connectionId !== state.connectionId) return;
      if (message.type === "answer") {
        const previousFingerprint = state.binding?.hostFingerprint;
        const nextFingerprint = message.sdp
          .match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/imu)?.[1]
          ?.trim()
          .toUpperCase();
        if (previousFingerprint && nextFingerprint !== previousFingerprint) {
          return yield* new RemotePeerError({ message: sourceText("error.remote.connectionDropped") });
        }
        yield* peerCall(() => state.connection?.setRemoteDescription({ type: "answer", sdp: message.sdp }));
        state.iceRestartSentAt = null;
        for (const line of sdpCandidateLines(message.sdp)) state.remoteCandidates.add(line);
        yield* notify(
          diagnosticCall(
            state,
            "answer",
            `${state.offerSentAt === null ? "no offer time" : `${Date.now() - state.offerSentAt} ms after offer`}${state.offerKind ? `, ${state.offerKind}` : ""}`,
          ),
        );
      } else if (message.type === "ice-candidate") {
        yield* peerCall(() =>
          state.connection?.addIceCandidate({
            candidate: message.candidate,
            sdpMid: message.sdpMid,
            sdpMLineIndex: message.sdpMLineIndex,
          }),
        );
        state.remoteCandidates.add(message.candidate);
      } else {
        yield* restartIce(state);
      }
    })();
  }

  function createPeerConnection(state: PeerState, iceServers: RTCIceServer[], actions: ActionsRef): RTCPeerConnection {
    if (typeof RTCPeerConnection !== "function")
      throw referenced(sourceText("error.remote.webrtcBlocked"), "webrtc/unavailable");
    const connection = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
    state.connection = connection;
    state.iceRestarts = 0;
    state.iceRestartSentAt = null;
    state.iceRestartAt = null;
    connection.onicecandidate = (event) => {
      if (event.candidate?.candidate && state.connection === connection)
        state.localCandidates.add(event.candidate.candidate);
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
    const candidateErrors = new Set<string>();
    connection.onicecandidateerror = (event) => {
      if (state.connection !== connection || state.closed || peer !== state) return;
      const key = `${event.url} ${event.errorCode}`;
      if (candidateErrors.has(key)) return;
      candidateErrors.add(key);
      diagnose(state, "ice-candidate-error", iceServerErrorDetail(event.url, event.errorCode, event.errorText));
    };
    connection.onicegatheringstatechange = () => {
      if (state.connection !== connection || state.closed || peer !== state) return;
      const gathering = connection.iceGatheringState;
      diagnose(
        state,
        "ice-gathering",
        gathering === "complete" ? `complete, local ${candidateCounts(state.localCandidates)}` : gathering,
      );
    };
    connection.oniceconnectionstatechange = () => {
      if (state.connection !== connection || state.closed || peer !== state) return;
      diagnose(state, "ice-state", connection.iceConnectionState);
    };
    connection.onconnectionstatechange = () => {
      if (state.connection !== connection || state.closed || peer !== state) return;
      const connectionState = connection.connectionState;
      diagnose(state, "peer-state", connectionState);
      if (connectionState === "connected") void runPeerEffect(reportRoute(state, connection)).catch(() => undefined);
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
        failPeer(state, iceFailure(connectionState), actions);
      }
    };
    return connection;
  }

  function bindChannel(state: PeerState, kind: ChannelKind, channel: RTCDataChannel, actions: ActionsRef): void {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    state.channels[kind] = channel;
    state.decoders[kind] = new TeamWebRtcPayloadDecoder();
    let handled = Promise.resolve();
    channel.onopen = () => {
      if (CHANNELS.every((name) => state.channels[name]?.readyState === "open") && !state.binding) {
        diagnose(state, "channels-open");
        void runPeerEffect(beginAuthentication(state)).catch((error) => failPeer(state, error, actions));
      }
    };
    channel.onmessage = (event) => {
      const data = event.data;
      handled = handled
        .then(() =>
          runPeerEffect(
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
        )
        .catch((error) => failPeer(state, error, actions));
    };
    channel.onerror = () => {
      if (state.channels[kind] !== channel) return;
      failPeer(
        state,
        referenced(sourceText("error.remote.dataChannelFailed", { kind }), referenceFrom("webrtc", "channel", kind)),
        actions,
      );
    };
    channel.onclose = () => {
      if (state.authenticated && state.channels[kind] === channel)
        failPeer(state, referenced(sourceText("error.remote.desktopOffline"), "webrtc/channel/closed"), actions);
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
        state.lastAnswerAt = performance.now();
        const pending = pendingRequests.get(frame.requestId);
        if (!pending) return;
        pending.profile?.responded(data);
        if ("error" in frame)
          pending.reject(referenced(frame.error.message, referenceFrom("host", frame.error.status, frame.error.code)));
        else if (!isDynamicRecord(frame.result) || !isNumber(frame.result.status) || !("body" in frame.result)) {
          pending.reject(new Error("The host returned an invalid response."));
        } else if (isDynamicRecord(frame.result.file) && isString(frame.result.file.transferId)) {
          clearTimeout(pending.timer);
          const status = frame.result.status;
          void runPeerEffect(downloads.take(frame.result.file.transferId)).then(
            (file) => pending.resolve({ status, body: { ...file } }),
            (error: unknown) => pending.reject(error instanceof Error ? error : peerError(error)),
          );
        } else {
          const sideRoute = teamSideRouteCodec(pending.path);
          const status = frame.result.status;
          const body = frame.result.body;
          if (pending.method === "GET" && pending.path === TEAM_API_ROUTES.compatibility && status === 200) {
            const host = (yield* peerDecode(() => decodeTeamProtocolSupportExpanded(body))).protocol;
            state.hostProtocol = teamWebRtcClientProtocol(host, clientProtocol).protocol ?? host.maximum;
            hostProtocols.set(state.hostId, state.hostProtocol);
          }
          pending.resolve({
            status: frame.result.status,
            body: sideRoute
              ? yield* peerDecode(() =>
                  sideRoute.response(pending.path, status, body, {
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
                  }),
                )
              : yield* peerDecode(() =>
                  withWireBlockExtensions(
                    state,
                    decodeTeamProtocolV10WebRtcHttpResponse(pending.method, pending.path, status, body),
                    body,
                  ),
                ),
          });
        }
        clearTimeout(pending.timer);
        pendingRequests.delete(frame.requestId);
        return;
      }
      if (kind !== "events") return;
      const frame = yield* peerDecode(() => decodeTeamProtocolV2EventFrame(data));
      if (frame.type === "event-reset") {
        diagnose(state, "event-reset", `after ${state.lastEventSequence}, next ${frame.nextSequence}`);
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
      if (frame.sequence !== state.lastEventSequence + 1) {
        diagnose(state, "event-gap", `expected ${state.lastEventSequence + 1}, got ${frame.sequence}`);
        return yield* new RemotePeerError({ message: sourceText("error.remote.eventStreamGap") });
      }
      const channel = yield* peerDecode(() => optionalTeamEvent(frame.payload, { agentTaskUiBlocks: true }));
      const decoded = channel
        ? { status: "known" as const, event: optionalTeamEventToCurrent(channel) }
        : yield* peerDecode(() => decodeTeamProtocolV8CurrentEvent(frame));
      if (decoded.status === "invalid")
        return yield* new RemotePeerError({ message: sourceText("error.remote.malformedEvent") });
      state.lastEventSequence = frame.sequence;
      if (decoded.status === "known") {
        if (sendsBlockExtensions(state)) {
          addUiBlockAutoAnswers(decoded.event, frame.payload);
          addUiBlockVaultRequests(decoded.event, frame.payload);
          addUiBlockLocationRequests(decoded.event, frame.payload);
          addSkillSuggestionNames(decoded.event, frame.payload);
        }
        yield* RemotePeerIO.use((io) => io.teamEvent(state.hostId, decoded.event));
      }
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
      yield* RemotePeerIO.use((io) =>
        io.connectionUpdate({
          hostId: state.hostId,
          state: "online",
          message: null,
          lostAfterMs: peerLostAfterMs(state),
        }),
      );
    })();
  }

  function requestEffect(
    method: string,
    path: string,
    body: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    onUploadProgress?: (sent: number, total: number) => void,
    timeoutMs = REQUEST_TIMEOUT_MS,
    largeDownload?: RemoteLargeDownload,
    download?: RemoteDownloadWatch,
  ) {
    return Effect.fn("RemotePeer.request")(function* () {
      const state = peer;
      if (!state || !isPeerOnline(state)) {
        if (state && (method === "GET" || method === "HEAD")) state.needsResync = true;
        return yield* new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") });
      }
      const checksConnection = method === "GET" && path === TEAM_API_ROUTES.compatibility;
      const protocolRead = checksConnection ? Deferred.makeUnsafe<void>() : null;
      if (protocolRead) state.hostProtocolRead = protocolRead;
      else if (state.hostProtocol === undefined && state.hostProtocolRead)
        yield* Deferred.await(state.hostProtocolRead);
      const delivery = upload && onUploadProgress ? trackUploadDelivery(state, onUploadProgress) : null;
      const releaseDownload =
        largeDownload === undefined
          ? null
          : downloads.allow(
              Math.min(largeDownload.maxBytes, TEAM_PROTOCOL_V2_MAX_FILE_BYTES),
              largeDownload.mimeType,
              downloadTarget(largeDownload.file),
            );
      const stopDownloadWatch = download ? downloads.watch(download.size, download.onProgress) : null;
      return yield* Effect.gen(function* () {
        const bodyTransferId = upload ? yield* files.upload(upload, delivery?.queued) : null;
        if (peer !== state || !isPeerOnline(state))
          return yield* new RemotePeerError({ message: sourceText("error.remote.attachmentConnectionChanged") });
        const sideRoute = teamSideRouteCodec(path);
        const payloadBody = upload
          ? null
          : sideRoute
            ? yield* peerDecode(() =>
                sideRoute.request(path, body, {
                  channelIsolation: true,
                  channelPicture: true,
                  channelBrowser: true,
                  providerManyAccounts: true,
                }),
              )
            : // A caller names a provider and model on agent creation only when the host advertises
              yield* peerDecode(() =>
                encodeTeamProtocolV9WebRtcHttpRequest(method, path, body, {
                  preserveSemanticTags: true,
                  agentCreateModel: true,
                }),
              );
        const requestId = createTeamRequestId((size) => crypto.getRandomValues(new Uint8Array(size)));
        const capabilityProtocol =
          !checksConnection || (state.hostProtocol !== undefined && state.hostProtocol >= TEAM_PROTOCOL_V10)
            ? state.hostProtocol
            : undefined;
        const sentCapabilities = teamCapabilitiesForProtocol(capabilityProtocol);
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
              ...(bodyTransferId && upload ? { bodyTransferId, contentType: upload.mimeType } : {}),
              ...teamCapabilityLists(capabilityProtocol, sentCapabilities),
            },
          }),
        );
        const connection = state.connection;
        const sent = checksConnection && connection ? yield* sentOnPath(connection) : null;
        const arm: ProbeArm | null = sent && {
          at: Date.now(),
          rttMs: sent.rttMs,
          bytesSent: sent.bytesSent,
          bytesReceived: sent.bytesReceived,
          rpcBuffered: state.channels.rpc?.bufferedAmount ?? 0,
          probeBytes: new TextEncoder().encode(payload).byteLength,
          fresh: !state.answeredRequest,
          limitMs: timeoutMs,
        };
        const answer = Deferred.makeUnsafe<{ status: number; body: TeamProtocolV2Json }, RemotePeerError>();
        const response = yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const reject = (error: Error) => Deferred.doneUnsafe(answer, Effect.fail(peerError(error)));
            const expire = () => {
              if (pendingRequests.get(requestId) !== pending) return;
              pendingRequests.delete(requestId);
              const error = new Error(sourceText("error.remote.desktopRequestTimeout"));
              reject(error);
              if (checksConnection) failPeer(state, error, actions);
              else probePathAfterTimeout(state);
            };
            const samples: ProbeSample[] = [];
            const checkPath = () => {
              if (!connection || !arm) return expire();
              void runPeerEffect(sentOnPath(connection)).then((now) => {
                if (pendingRequests.get(requestId) !== pending) return;
                if (!now) return expire();
                const sample = { at: Date.now(), bytesSent: now.bytesSent, bytesReceived: now.bytesReceived };
                const verdict = judgePath(arm, samples, sample);
                samples.push(sample);
                if (verdict.kind === "pending") {
                  pending.timer = setTimeout(checkPath, verdict.recheckAt - sample.at);
                  return;
                }
                const restartEnds = state.iceRestartAt === null ? 0 : state.iceRestartAt + ICE_RESTART_PROBE_MS;
                if (sample.at < restartEnds && !state.closed && peer === state) {
                  pending.timer = setTimeout(checkPath, Math.min(PATH_CHECK_INTERVAL_MS, restartEnds - sample.at));
                  return;
                }
                diagnose(state, "path-check", verdict.reason);
                expire();
              }, expire);
            };
            const resolve = (value: { status: number; body: TeamProtocolV2Json }) =>
              Deferred.doneUnsafe(answer, Effect.succeed(value));
            const pending: PendingRequest = {
              method,
              path,
              resolve,
              reject,
              profile: startRemoteRequest(method, path, payload),
              timer: checksConnection
                ? setTimeout(
                    checkPath,
                    Math.min(arm ? PATH_CHECK_INTERVAL_MS : unmeasuredProbeMs(!state.answeredRequest), timeoutMs),
                  )
                : startRemoteRequestDeadline(
                    timeoutMs,
                    () => state.lastAnswerAt,
                    expire,
                    (timer) => {
                      pending.timer = timer;
                    },
                  ),
            };
            pendingRequests.set(requestId, pending);
            return pending;
          }),
          () =>
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
          (pending, exit) =>
            Effect.sync(() => {
              clearTimeout(pending.timer);
              pendingRequests.delete(requestId);
              pending.profile?.end(exit);
            }),
        );
        delivery?.complete();
        if (!state.fullSnapshotRequested && sentCapabilities !== TEAM_BOOTSTRAP_CAPABILITIES) {
          state.fullSnapshotRequested = true;
          void runPeerEffect(sendEventControl(state, { type: "runtime-snapshot-request" })).catch(() => {
            state.fullSnapshotRequested = false;
          });
        }
        return response;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            delivery?.stop();
            releaseDownload?.();
            stopDownloadWatch?.();
            if (protocolRead) Deferred.doneUnsafe(protocolRead, Effect.void);
          }),
        ),
      );
    })();
  }

  function probePathAfterTimeout(state: PeerState): void {
    if (state.probingPath || state.closed || peer !== state || !isPeerOnline(state)) return;
    state.probingPath = true;
    diagnose(state, "path-check", "request timeout");
    void runPeerEffect(requestEffect("GET", TEAM_API_ROUTES.compatibility, null))
      .catch(() => undefined)
      .finally(() => {
        state.probingPath = false;
      });
  }

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
      onProgress(Math.max(0, Math.min(total, queued - buffered)), total);
      if (buffered === 0 && queued >= total) stop();
    };
    return {
      queued(sent: number, size: number) {
        queued = sent;
        total = size;
        report();
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
      if (!connection || !state.connectionId || state.offerPending) return;
      if (state.iceRestarts >= HOST_ICE_RESTART_LIMIT) {
        failPeer(state, referenced(sourceText("error.remote.connectionDropped"), "webrtc/ice/restart_limit"), actions);
        return;
      }
      state.iceRestarts += 1;
      state.iceRestartSentAt = Date.now();
      state.iceRestartAt = state.iceRestartSentAt;
      const connectionId = state.connectionId;
      const startedAt = Date.now();
      state.localCandidates.clear();
      state.remoteCandidates.clear();
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
      state.offerSentAt = Date.now();
      state.offerKind = "ICE restart";
      yield* notify(diagnosticCall(state, "offer-sent", `ICE restart, made in ${state.offerSentAt - startedAt} ms`));
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
    if (Date.now() < signalRetryAt && state.connectedTimer !== null) {
      clearTimeout(state.connectedTimer);
      state.connectedTimer = null;
    }
    const delay = Math.max(
      signalRetryAt - Date.now(),
      isPeerOnline(state) || canRecoverPeer(state) || state.waitingForHost
        ? signalRetryDelay(state.reconnectAttempt++)
        : 60_000,
    );
    diagnose(state, "signal-retry", `in ${delay} ms`);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      reopenSignal(state, actions);
    }, delay);
  }

  function resumeTurnRefresh(state: PeerState): void {
    scheduleTurnRefresh(state, Math.max(0, state.turnRefreshDueAt - Date.now()));
  }

  function scheduleTurnRefresh(state: PeerState, delay = SIGNAL_TURN_REFRESH_INTERVAL_MS): void {
    if (!active || state.closed || peer !== state) return;
    state.turnRefreshDueAt = Date.now() + delay;
    armTurnRefresh(state, delay);
  }

  function armTurnRefresh(state: PeerState, delay: number): void {
    if (!active || state.closed || peer !== state) return;
    if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
    state.turnRefreshTimer = setTimeout(() => {
      state.turnRefreshTimer = null;
      if (canSignal(state)) {
        try {
          sendSignal(state, { type: "turn-refresh", version: SIGNAL_PROTOCOL_VERSION, connectionId: null });
        } catch {}
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
    const failure = referenced(failureMessage(error), failureReference(error));
    diagnose(state, "failed", failureDetail(failure, code));
    rejectConnection(state, failure);
    void runPeerEffect(connectionOffline(state, failure, actions, code));
    void runPeerEffect(closePeer(actions.current.endSession, code === undefined));
  }

  function failPeerEffect(
    state: PeerState,
    error: unknown,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    return Effect.gen(function* () {
      if (state.closed || peer !== state) return;
      const failure = referenced(failureMessage(error), failureReference(error));
      yield* notify(diagnosticCall(state, "failed", failureDetail(failure, code)));
      rejectConnection(state, failure);
      yield* notify(connectionOffline(state, failure, actions, code));
      yield* Effect.forkIn(closePeer(actions.current.endSession, code === undefined).pipe(Effect.ignore), workScope, {
        startImmediately: true,
        uninterruptible: true,
      });
    });
  }

  function failureDetail(failure: RemotePeerError, code?: RemoteTeamConnectionUpdate["code"]): string {
    const text = code ? `${code}: ${failure.message}` : failure.message;
    return failure.reference ? `${text} [${failure.reference}]` : text;
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : sourceText("error.remote.webRtcConnectionFailed");
  }

  function iceFailure(connectionState: RTCPeerConnectionState | undefined): RemotePeerError {
    if (connectionState === "failed") return referenced(sourceText("error.remote.iceFailed"), "webrtc/ice/failed");
    if (connectionState === "closed")
      return referenced(sourceText("error.remote.iceDisconnected"), "webrtc/ice/closed");
    return referenced(sourceText("error.remote.iceDisconnected"), "webrtc/ice/disconnected");
  }

  function connectTimeout(state: PeerState): RemotePeerError {
    const connection = state.offerPending ? null : state.connection;
    if (!connection && state.lastSignalClose !== null)
      return referenced(
        sourceText("error.remote.signalClosed"),
        referenceFrom("signal", "close", state.lastSignalClose),
      );
    const stage = !connection
      ? "signal"
      : connection.connectionState !== "connected"
        ? "ice"
        : !CHANNELS.every((kind) => state.channels[kind]?.readyState === "open")
          ? "channels"
          : "auth";
    return referenced(sourceText("error.remote.desktopDidNotConnect"), referenceFrom("timeout", "connect", stage));
  }

  function connectionOffline(
    state: PeerState,
    failure: RemotePeerError,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    const reference = failure.reference;
    return peerCall(() =>
      actions.current.onConnectionUpdate({
        hostId: state.hostId,
        state: "offline",
        message: failure.message,
        ...(code ? { code } : {}),
        ...(reference ? { reference } : {}),
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
      if (state.hostWaitTicketTimer !== null) clearTimeout(state.hostWaitTicketTimer);
      state.socket?.close();
      state.preparedSocket?.close();
      state.preparedSocket = null;
      state.connection?.close();
      for (const decoder of Object.values(state.decoders)) decoder?.reset();
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

  function armConnectedTimer(state: PeerState, actions: ActionsRef): void {
    if (!state.connected || state.connectedTimer !== null) return;
    state.connectedTimer = setTimeout(() => {
      diagnose(state, "stalled", `connect deadline: ${connectionSnapshot(state)}`);
      failPeer(state, connectTimeout(state), actions);
    }, 30_000);
  }

  function connectionSnapshot(state: PeerState): string {
    const connection = state.connection;
    const signal = `Signal ${state.socket ? (state.signalReady ? "ready" : "open, no ready") : "closed"}`;
    if (!connection) return `${signal}, no connection`;
    const open = CHANNELS.filter((kind) => state.channels[kind]?.readyState === "open").length;
    return [
      signal,
      `offer ${state.offerSentAt === null ? "not sent" : `sent ${Date.now() - state.offerSentAt} ms ago`}`,
      `signaling ${connection.signalingState}`,
      `ICE ${connection.iceConnectionState}`,
      `gathering ${connection.iceGatheringState}`,
      `local ${candidateCounts(state.localCandidates)}`,
      `remote ${candidateCounts(state.remoteCandidates)}`,
      `channels ${open}/${CHANNELS.length}`,
      `auth ${state.authenticated ? "done" : state.binding ? "started" : "not started"}`,
    ].join(", ");
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

function candidateType(candidate: string): string {
  const word = candidate.split(" ")[2]?.toLowerCase();
  const protocol = word === "udp" || word === "tcp" ? word : "unknown";
  const type = / typ (host|srflx|prflx|relay)\b/u.exec(candidate)?.[1] ?? "unknown";
  return `${type}/${protocol}`;
}

function sdpCandidateLines(sdp: string): string[] {
  return [...sdp.matchAll(/^a=(candidate:[^\r\n]+)$/gmu)].map((match) => match[1] ?? "");
}

function candidateCounts(candidates: Set<string>): string {
  const counts = new Map<string, number>();
  for (const line of candidates) {
    const type = candidateType(line);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts.size === 0 ? "none" : [...counts].map(([type, count]) => `${type}:${count}`).join(" ");
}

function signalErrorCode(data: string): string | null {
  try {
    const message = decodeSignalServerMessage(JSON.parse(data));
    return message?.type === "error" ? message.code : null;
  } catch {
    return null;
  }
}

function sendsBlockExtensions(state: PeerState): boolean {
  return (state.hostProtocol ?? 0) >= TEAM_PROTOCOL_V9;
}

function withWireBlockExtensions<T>(state: PeerState, decoded: T, wire: unknown): T {
  if (sendsBlockExtensions(state)) {
    addUiBlockAutoAnswers(decoded, wire);
    addUiBlockVaultRequests(decoded, wire);
    addUiBlockLocationRequests(decoded, wire);
    addSkillSuggestionNames(decoded, wire);
  }
  return decoded;
}
