import { isString } from "@openbot/contracts/runtime-values";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_NO_READY_CLOSE_CODE,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_TURN_REFRESH_INTERVAL_MS,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
import { BROWSER_EGRESS_CHANNEL } from "@openbot/contracts/team-protocol/browser-egress-v1";
import { TEAM_PROTOCOL_V2_CHANNELS } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { iceCandidateRoute } from "@openbot/team-client/ice-diagnostics";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./team-webrtc-framing";
import { isPrivateNetworkCandidate, privateNetworkSdp } from "./team-webrtc-private-network";

export interface BridgeCommand {
  commandId: string;
  type:
    | "connect"
    | "prepare-signal"
    | "disconnect"
    | "disconnect-peer"
    | "send"
    | "restart-ice"
    | "renew-host-signal"
    | "set-private-network"
    | "open-egress"
    | "close-egress"
    | "send-egress"
    | "close"
    | "ping";
  peerId: string;
  signalUrl?: string;
  token?: string;
  peer?: "host" | "client";
  iceTransportPolicy?: "all" | "relay";
  privateNetwork?: boolean;
  waitForHost?: boolean;
  channel?: "rpc" | "events" | "files" | "desktop";
  data?: string | ArrayBuffer;
}

interface MainBridgeMessage {
  type: string;
  commandId?: string;
  peerId?: string;
  hostId?: string;
  channel?: "rpc" | "events" | "files" | "desktop";
  data?: string | ArrayBuffer;
  path?: "p2p" | "relay";
  route?: string;
  side?: "host" | "client";
  url?: string;
  errorCode?: number;
  errorText?: string;
  code?: string;
  message?: string;
  terminal?: boolean;
  connectionId?: string | null;
  sessionId?: string;
  userId?: string;
  membershipId?: string;
  role?: "owner" | "admin" | "member";
  sessionExpiresAt?: number;
  localFingerprint?: string;
  remoteFingerprint?: string;
  iceServers?: RTCIceServer[];
  retryInMs?: number;
}

interface PeerState {
  id: string;
  signalHost: PeerState | null;
  clients: Map<string, PeerState>;
  role: "host" | "client";
  signalUrl: string;
  token: string;
  resumeToken: string | null;
  socket: WebSocket | null;
  connectionId: string | null;
  peerConnection: RTCPeerConnection | null;
  iceServers: RTCIceServer[];
  iceTransportPolicy: "all" | "relay";
  privateNetwork: boolean;
  waitForHost: boolean;
  channels: Partial<Record<"rpc" | "events" | "files" | "desktop", RTCDataChannel>>;
  payloadDecoders: Partial<Record<"rpc" | "events" | "files" | "desktop", TeamWebRtcPayloadDecoder>>;
  egress: RTCDataChannel | null;
  egressChain: Promise<void>;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  turnRefreshTimer: number | null;
  turnRefreshDueAt: number;
  signalRenewTimer: number | null;
  signalReadyTimer: number | null;
  signalProbeTimer: number | null;
  disconnectedTimer: number | null;
  iceRestartPending: boolean;
  iceRestarting: boolean;
  iceRestarts: number;
  restartIceOnReady: boolean;
  pathLost: boolean;
  signalChain: Promise<void>;
  closed: boolean;
}

const SIGNAL_RENEW_DELAY_MS = 8_000;
const DISCONNECT_GRACE_MS = 15_000;
const SIGNAL_READY_DEADLINE_MS = 30_000;
const SIGNAL_PROBE_INTERVAL_MS = 4 * 60_000;
const RELAYED_FRAME_DEADLINE_MS = 30_000;
const SIGNAL_HOLD_SPREAD_MS = 5_000;

const peers = new Map<string, PeerState>();
let signalRetryAt = 0;

interface PreparedSignal {
  signalUrl: string;
  socket: WebSocket;
  refused: boolean;
  timer: number;
  listeners: AbortController;
}
const PREPARED_SIGNAL_LIFETIME_MS = 30_000;
const preparedSignals = new Map<string, PreparedSignal>();
const dataChannelNames = ["rpc", "events", "files", "desktop"] as const;
const maximumIceRestarts = 10;
let mainPort: MessagePort;

const receiveMainPort = (event: MessageEvent): void => {
  if (event.source !== window || event.data !== "openbot-team-webrtc-port") return;
  const port = event.ports[0];
  if (!port) throw new Error("The Team WebRTC message port is missing.");
  window.removeEventListener("message", receiveMainPort);
  mainPort = port;
  mainPort.onmessage = (event: MessageEvent<BridgeCommand>) => void handleCommand(event.data);
  mainPort.start();
  post({ type: "bridge-ready" });
};
window.addEventListener("message", receiveMainPort);

window.addEventListener("online", () => {
  for (const state of peers.values()) if (!state.signalHost) replaceSignal(state);
});

async function handleCommand(command: BridgeCommand): Promise<void> {
  try {
    if (command.type === "connect") {
      if (
        !command.signalUrl ||
        !command.token ||
        !command.peer ||
        (command.iceTransportPolicy !== "all" && command.iceTransportPolicy !== "relay")
      )
        throw new Error("The WebRTC connection command is invalid.");
      const prepared = takePreparedSignal(command.peerId, command.signalUrl);
      disconnect(command.peerId);
      const state: PeerState = {
        id: command.peerId,
        signalHost: null,
        clients: new Map(),
        role: command.peer,
        signalUrl: command.signalUrl,
        token: command.token,
        resumeToken: null,
        socket: null,
        connectionId: null,
        peerConnection: null,
        iceServers: [],
        iceTransportPolicy: command.iceTransportPolicy,
        privateNetwork: command.peer === "host" && command.privateNetwork === true,
        waitForHost: command.peer === "client" && command.waitForHost === true,
        channels: {},
        payloadDecoders: {},
        egress: null,
        egressChain: Promise.resolve(),
        reconnectAttempt: 0,
        reconnectTimer: null,
        turnRefreshTimer: null,
        turnRefreshDueAt: 0,
        signalRenewTimer: null,
        signalReadyTimer: null,
        signalProbeTimer: null,
        disconnectedTimer: null,
        iceRestartPending: false,
        iceRestarting: false,
        iceRestarts: 0,
        restartIceOnReady: false,
        pathLost: false,
        signalChain: Promise.resolve(),
        closed: false,
      };
      peers.set(state.id, state);
      connectSignal(state, prepared);
    } else if (command.type === "prepare-signal") {
      if (!command.signalUrl) throw new Error("The WebRTC connection command is invalid.");
      prepareSignal(command.peerId, command.signalUrl);
    } else if (command.type === "disconnect") {
      disconnect(command.peerId);
    } else if (command.type === "disconnect-peer") {
      const state = requirePeer(command.peerId);
      if (state.signalHost) disconnect(state.id);
      else disconnectPeerConnection(state);
    } else if (command.type === "send") {
      const state = requirePeer(command.peerId);
      const channel = command.channel ? state.channels[command.channel] : null;
      if (channel?.readyState !== "open" || command.data === undefined)
        throw new Error(sourceText("error.remote.channelNotOpen"));
      await sendChannelPayload(state, channel, command.data);
    } else if (command.type === "open-egress") {
      const state = requirePeer(command.peerId);
      if (state.role !== "client" || !state.peerConnection || state.channels.rpc?.readyState !== "open")
        throw new Error(sourceText("error.remote.channelNotOpen"));
      if (!state.egress || state.egress.readyState === "closing" || state.egress.readyState === "closed")
        bindEgressChannel(state, state.peerConnection.createDataChannel(BROWSER_EGRESS_CHANNEL, { ordered: true }));
    } else if (command.type === "close-egress") {
      const state = peers.get(command.peerId);
      state?.egress?.close();
    } else if (command.type === "send-egress") {
      const state = requirePeer(command.peerId);
      const channel = state.egress;
      const data = command.data;
      if (channel?.readyState !== "open" || data === undefined)
        throw new Error(sourceText("error.remote.channelNotOpen"));
      const sent = state.egressChain.then(async () => {
        await waitForWritableChannel(channel);
        if (channel.readyState !== "open") throw new Error(sourceText("error.remote.channelNotOpen"));
        if (isString(data)) channel.send(data);
        else channel.send(data);
      });
      state.egressChain = sent.catch(() => undefined);
      await sent;
    } else if (command.type === "restart-ice") {
      await restartIce(requirePeer(command.peerId));
    } else if (command.type === "renew-host-signal") {
      for (const state of peers.values()) if (state.role === "host" && !state.signalHost) replaceSignal(state);
    } else if (command.type === "set-private-network") {
      const host = peers.get(command.peerId);
      if (host) setPrivateNetwork(host, command.privateNetwork === true);
    } else if (command.type === "close") {
      for (const peerId of [...preparedSignals.keys()]) dropPreparedSignal(peerId);
      for (const peerId of [...peers.keys()]) disconnect(peerId);
    }
    post({ type: "command-complete", commandId: command.commandId });
  } catch (error) {
    post({
      type: "command-error",
      commandId: command.commandId,
      message: commandFailureText(error),
    });
  }
}

function commandFailureText(error: unknown): string {
  return error instanceof Error && error.name === "Error"
    ? error.message
    : sourceText("error.remote.webRtcCommandFailed");
}

function prepareSignal(peerId: string, signalUrl: string): void {
  if (peers.has(peerId)) return;
  dropPreparedSignal(peerId);
  if (Date.now() < signalRetryAt) return;
  const socket = new WebSocket(signalUrl);
  const listeners = new AbortController();
  const prepared: PreparedSignal = {
    signalUrl,
    socket,
    refused: false,
    timer: window.setTimeout(() => dropPreparedSignal(peerId), PREPARED_SIGNAL_LIFETIME_MS),
    listeners,
  };
  const drop = () => {
    if (preparedSignals.get(peerId) === prepared) dropPreparedSignal(peerId);
  };
  socket.addEventListener("open", () => post({ type: "signal-open", peerId }), { signal: listeners.signal });
  let refusal: string | null = null;
  socket.addEventListener(
    "message",
    (event) => {
      prepared.refused = true;
      refusal = signalErrorCode(event.data) ?? refusal;
    },
    { signal: listeners.signal },
  );
  socket.addEventListener(
    "close",
    (event) => {
      holdSignalAfterClose(event.code, refusal);
      drop();
    },
    { signal: listeners.signal },
  );
  socket.addEventListener("error", drop, { signal: listeners.signal });
  preparedSignals.set(peerId, prepared);
}

function takePreparedSignal(peerId: string, signalUrl: string): WebSocket | null {
  const prepared = preparedSignals.get(peerId);
  if (!prepared) return null;
  preparedSignals.delete(peerId);
  clearTimeout(prepared.timer);
  prepared.listeners.abort();
  const usable =
    prepared.signalUrl === signalUrl &&
    !prepared.refused &&
    (prepared.socket.readyState === WebSocket.CONNECTING || prepared.socket.readyState === WebSocket.OPEN);
  if (usable) return prepared.socket;
  prepared.socket.close(1000, "Peer stopped");
  return null;
}

function dropPreparedSignal(peerId: string): void {
  takePreparedSignal(peerId, "")?.close(1000, "Peer stopped");
}

function connectSignal(state: PeerState, prepared: WebSocket | null = null): void {
  if (state.closed || state.socket) {
    prepared?.close(1000, "Peer stopped");
    return;
  }
  if (Date.now() < signalRetryAt) {
    prepared?.close(1000, "Signal retry pending");
    scheduleSignalReconnect(state);
    return;
  }
  const socket = prepared ?? new WebSocket(state.signalUrl);
  state.socket = socket;
  if (state.role === "host") state.signalChain = Promise.resolve();
  const sendHello = () => {
    const hello: SignalClientMessage = {
      type: "hello",
      version: SIGNAL_PROTOCOL_VERSION,
      peer: state.role,
      token: state.resumeToken ?? state.token,
      ...(state.role === "host" ? { multiplex: true } : {}),
      ...(state.waitForHost ? { waitForHost: true } : {}),
    };
    socket.send(JSON.stringify(hello));
    awaitSignalReady(state, socket);
  };
  const open = prepared?.readyState === WebSocket.OPEN;
  if (!open)
    socket.addEventListener("open", () => {
      post({ type: "signal-open", peerId: state.id });
      sendHello();
    });
  let refusal: string | null = null;
  socket.addEventListener("message", (event) => {
    if (!isString(event.data)) return;
    refusal = signalErrorCode(event.data) ?? refusal;
    state.signalChain = state.signalChain
      .then(async () => {
        if (state.closed || state.socket !== socket) return;
        let message: SignalServerMessage | null;
        try {
          message = decodeSignalServerMessage(JSON.parse(event.data));
        } catch {
          return failSignalProtocol(state);
        }
        if (message) await handleSignal(state, message);
      })
      .catch(() => failPeer(state))
      .then(() => {
        if (state.socket === socket) probeSignalLater(state);
      });
  });
  socket.addEventListener("close", (event) => {
    if (state.socket !== socket) return;
    state.socket = null;
    clearSignalLiveness(state);
    if (state.role === "host" && !state.closed)
      post({ type: "signal-closed", peerId: state.id, code: String(event.code), terminal: event.code === 4000 });
    if (event.code === 4000) {
      disconnect(state.id);
      post({ type: "peer-disconnected", peerId: state.id });
      return;
    }
    holdSignalAfterClose(event.code, refusal);
    if (!state.closed) scheduleSignalReconnect(state);
  });
  socket.addEventListener("error", () => socket.close());
  if (open) sendHello();
}

async function handleSignal(state: PeerState, message: SignalServerMessage): Promise<void> {
  if (
    message.type === "slack-delivery" ||
    message.type === "discord-session" ||
    message.type === "discord-delivery" ||
    message.type === "webhook-ready" ||
    message.type === "webhook-delivery" ||
    message.type === "github-ready" ||
    message.type === "github-delivery" ||
    message.type === "telegram-delivery" ||
    message.type === "telegram-call-result" ||
    message.type === "queued-delivery"
  )
    return;
  if (message.type === "host-waiting") {
    state.reconnectAttempt = 0;
    state.resumeToken = message.resumeToken;
    post({ type: "host-waiting", peerId: state.id });
    return;
  }
  if (message.type === "account-profile-changed") {
    post({ type: "account-profile-changed", peerId: state.id });
    return;
  }
  if (message.type === "account-servers-changed") {
    post({ type: "account-servers-changed", peerId: state.id });
    return;
  }
  if (message.type === "error") {
    if (message.code === "rate_limited") {
      signalRetryAt = Date.now() + 60_000;
      state.socket?.close();
    }
    const staleRelay = message.code === "permission_denied" && state.role === "host";
    const terminal =
      message.code === "session_revoked" ||
      message.code === "authentication_required" ||
      (message.code === "permission_denied" && !staleRelay) ||
      message.code === "host_busy";
    post({
      type: "peer-error",
      peerId: state.id,
      code: message.code,
      message: message.message,
      terminal,
    });
    if (terminal) {
      disconnect(state.id);
      post({ type: "peer-disconnected", peerId: state.id });
    }
    return;
  }
  if (message.type === "ready") {
    state.reconnectAttempt = 0;
    const turnRefresh = message.connectionId === null;
    const client = state.role === "client" && state.connectionId ? state.peerConnection : null;
    const shouldRestartIce = Boolean(
      client &&
        (state.restartIceOnReady ||
          client.connectionState !== "connected" ||
          (turnRefresh &&
            (await selectedPath(client).then(
              ({ path }) => path,
              () => "relay",
            )) === "relay")),
    );
    state.restartIceOnReady = false;
    state.resumeToken = message.resumeToken;
    state.connectionId = message.connectionId ?? state.connectionId;
    state.iceServers = message.iceServers;
    for (const client of state.clients.values()) {
      client.iceServers = state.iceServers;
      client.peerConnection?.setConfiguration({
        iceServers: usableIceServers(client),
        bundlePolicy: "max-bundle",
        iceTransportPolicy: client.iceTransportPolicy,
      });
      post({ type: "ice-servers", peerId: client.id, iceServers: usableIceServers(client) });
    }
    if (state.peerConnection)
      state.peerConnection.setConfiguration({
        iceServers: usableIceServers(state),
        bundlePolicy: "max-bundle",
        iceTransportPolicy: state.iceTransportPolicy,
      });
    if (state.role === "client" && state.peerConnection && !shouldRestartIce && !turnRefresh)
      scheduleTurnRefresh(state, Math.max(0, state.turnRefreshDueAt - Date.now()));
    else scheduleTurnRefresh(state);
    post({ type: "ice-servers", peerId: state.id, iceServers: usableIceServers(state) });
    post({ type: "signal-ready", peerId: state.id });
    if (shouldRestartIce) state.iceRestartPending = true;
    if (state.iceRestartPending) await retryPendingIceRestart(state);
    if (state.role === "client" && state.connectionId && !state.peerConnection) {
      const connection = createPeerConnection(state, state.iceServers);
      createDataChannel(state, connection, "rpc");
      createDataChannel(state, connection, "events");
      createDataChannel(state, connection, "files");
      createDataChannel(state, connection, "desktop");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendSignal(state, {
        type: "offer",
        version: SIGNAL_PROTOCOL_VERSION,
        connectionId: state.connectionId,
        channel: "team",
        sdp: requiredDescriptionSdp(offer),
      });
    }
    return;
  }
  if (message.type === "peer-ready" && state.role === "host") {
    let client = state.clients.get(message.sessionId);
    if (client && !message.resumed) {
      disconnect(client.id);
      client = undefined;
    }
    if (!client) {
      client = {
        ...state,
        id: crypto.randomUUID(),
        signalHost: state,
        clients: new Map(),
        socket: null,
        connectionId: null,
        peerConnection: null,
        channels: {},
        payloadDecoders: {},
        reconnectTimer: null,
        turnRefreshTimer: null,
        turnRefreshDueAt: 0,
        signalRenewTimer: null,
        signalReadyTimer: null,
        signalProbeTimer: null,
        disconnectedTimer: null,
        pathLost: false,
        signalChain: Promise.resolve(),
      };
      state.clients.set(message.sessionId, client);
      peers.set(client.id, client);
    }
    client.connectionId = message.connectionId;
    post({
      type: "incoming-peer",
      peerId: client.id,
      hostId: state.id,
      connectionId: message.connectionId,
      sessionId: message.sessionId,
      userId: message.userId,
      membershipId: message.membershipId,
      role: message.role,
      sessionExpiresAt: message.sessionExpiresAt,
    });
    if (!client.peerConnection) createPeerConnection(client, client.iceServers);
    return;
  }
  if (state.role === "host" && !state.signalHost && message.connectionId) {
    const client = [...state.clients.values()].find((peer) => peer.connectionId === message.connectionId);
    if (client) {
      let deadline = 0;
      try {
        await Promise.race([
          handleSignal(client, message),
          new Promise<never>((_, reject) => {
            deadline = window.setTimeout(() => reject(new Error("Relayed frame timed out")), RELAYED_FRAME_DEADLINE_MS);
          }),
        ]);
      } catch {
        failPeer(client);
        disconnect(client.id);
      } finally {
        clearTimeout(deadline);
      }
    }
    return;
  }
  if (message.type === "disconnect" && message.connectionId === state.connectionId) {
    if (state.signalHost) {
      state.connectionId = null;
      disconnect(state.id);
      return;
    }
    clearPathRecovery(state);
    state.peerConnection?.close();
    state.peerConnection = null;
    state.connectionId = null;
    state.channels = {};
    for (const decoder of Object.values(state.payloadDecoders)) decoder?.reset();
    state.payloadDecoders = {};
    post({ type: "peer-disconnected", peerId: state.id });
    return;
  }
  if (
    message.type !== "offer" &&
    message.type !== "answer" &&
    message.type !== "ice-candidate" &&
    message.type !== "ice-restart"
  ) {
    return;
  }
  if (message.channel !== "team" || message.connectionId !== state.connectionId) return;
  if (message.type === "offer") {
    const connection = state.peerConnection ?? createPeerConnection(state, state.iceServers);
    if (restartsIce(connection, message.sdp) && ++state.iceRestarts > maximumIceRestarts) {
      dropConnection(state);
      return;
    }
    await connection.setRemoteDescription({
      type: "offer",
      sdp: state.privateNetwork ? privateNetworkSdp(message.sdp) : message.sdp,
    });
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    if (state.closed) return;
    sendSignal(state, {
      type: "answer",
      version: SIGNAL_PROTOCOL_VERSION,
      connectionId: message.connectionId,
      channel: "team",
      sdp: state.privateNetwork ? privateNetworkSdp(requiredDescriptionSdp(answer)) : requiredDescriptionSdp(answer),
    });
  } else if (message.type === "answer") {
    const previousFingerprint = sdpFingerprint(state.peerConnection?.remoteDescription?.sdp);
    if (previousFingerprint && sdpFingerprint(message.sdp) !== previousFingerprint) {
      dropConnection(state);
      return;
    }
    await state.peerConnection?.setRemoteDescription({ type: "answer", sdp: message.sdp });
  } else if (message.type === "ice-candidate") {
    if (state.privateNetwork && !isPrivateNetworkCandidate(message.candidate)) return;
    await state.peerConnection?.addIceCandidate({
      candidate: message.candidate,
      sdpMid: message.sdpMid,
      sdpMLineIndex: message.sdpMLineIndex,
    });
  } else {
    await restartIce(state);
  }
}

function createPeerConnection(state: PeerState, iceServers: RTCIceServer[]): RTCPeerConnection {
  const connection = new RTCPeerConnection({
    iceServers: state.privateNetwork ? [] : iceServers,
    bundlePolicy: "max-bundle",
    iceTransportPolicy: state.iceTransportPolicy,
  });
  state.peerConnection = connection;
  state.iceRestarts = 0;
  connection.onicecandidate = (event) => {
    if (!event.candidate?.candidate || !state.connectionId) return;
    if (state.privateNetwork && !isPrivateNetworkCandidate(event.candidate.candidate)) return;
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
  const candidateErrors = new Set<string>();
  connection.onicecandidateerror = (event) => {
    if (state.peerConnection !== connection) return;
    const key = `${event.url} ${event.errorCode}`;
    if (candidateErrors.has(key)) return;
    candidateErrors.add(key);
    post({
      type: "ice-candidate-error",
      peerId: state.id,
      side: state.role,
      url: event.url,
      errorCode: event.errorCode,
      errorText: event.errorText,
    });
  };
  connection.ondatachannel = (event) => {
    if (event.channel.label === BROWSER_EGRESS_CHANNEL && state.role === "host") {
      bindEgressChannel(state, event.channel);
      return;
    }
    const channel = channelKind(event.channel.label);
    if (channel) bindDataChannel(state, channel, event.channel);
  };
  connection.onconnectionstatechange = () => {
    if (state.peerConnection !== connection) return;
    if (connection.connectionState === "connected") {
      clearPathRecovery(state);
      void reportSelectedPath(state, connection).catch(() => undefined);
      if (state.signalHost && state.pathLost) {
        state.pathLost = false;
        post({ type: "peer-path-restored", peerId: state.id });
      }
    }
    if (connection.connectionState === "disconnected" || connection.connectionState === "failed")
      recoverPath(state, connection);
    if (connection.connectionState === "failed") {
      state.iceRestartPending = true;
      void retryPendingIceRestart(state);
      if (state.signalHost && !state.pathLost) {
        state.pathLost = true;
        post({ type: "peer-path-lost", peerId: state.id });
      }
    }
    if (connection.connectionState === "closed") post({ type: "peer-disconnected", peerId: state.id });
  };
  return connection;
}

function createDataChannel(
  state: PeerState,
  connection: RTCPeerConnection,
  channel: "rpc" | "events" | "files" | "desktop",
): void {
  const label = channel === "desktop" ? "openbot.remote-desktop.signal.v1" : TEAM_PROTOCOL_V2_CHANNELS[channel];
  bindDataChannel(state, channel, connection.createDataChannel(label, { ordered: true }));
}

function bindDataChannel(
  state: PeerState,
  kind: "rpc" | "events" | "files" | "desktop",
  channel: RTCDataChannel,
): void {
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 1024 * 1024;
  state.channels[kind] = channel;
  state.payloadDecoders[kind]?.reset();
  const decoder = new TeamWebRtcPayloadDecoder();
  state.payloadDecoders[kind] = decoder;
  channel.onopen = () => {
    if (dataChannelNames.every((name) => state.channels[name]?.readyState === "open")) {
      try {
        post({
          type: "peer-connected",
          peerId: state.id,
          connectionId: state.connectionId,
          localFingerprint: descriptionFingerprint(state.peerConnection?.localDescription ?? null),
          remoteFingerprint: descriptionFingerprint(state.peerConnection?.remoteDescription ?? null),
        });
      } catch {
        failPeer(state);
      }
    }
  };
  channel.onmessage = (event) => {
    if (state.channels[kind] !== channel) return;
    try {
      const data = decoder.push(event.data);
      if (data !== undefined) post({ type: "data", peerId: state.id, channel: kind, data });
    } catch {
      failPeer(state);
      disconnectPeerConnection(state);
      post({ type: "peer-disconnected", peerId: state.id });
    }
  };
  channel.onerror = () => {
    if (state.closed || state.channels[kind] !== channel) return;
    post({
      type: "peer-error",
      peerId: state.id,
      code: "data_channel_error",
      message: sourceText("error.remote.dataChannelFailed", { kind }),
    });
  };
  channel.onclose = () => {
    if (state.closed || state.channels[kind] !== channel) return;
    dropConnection(state);
  };
}

function bindEgressChannel(state: PeerState, channel: RTCDataChannel): void {
  const previous = state.egress;
  state.egress = channel;
  previous?.close();
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 1024 * 1024;
  const current = () => !state.closed && state.egress === channel;
  channel.onopen = () => {
    if (current()) post({ type: "egress-open", peerId: state.id });
  };
  channel.onmessage = (event) => {
    if (!current()) return;
    const data = egressFrame(event.data);
    if (data !== null) post({ type: "egress-data", peerId: state.id, data });
    else channel.close();
  };
  channel.onclose = () => {
    if (state.egress !== channel) return;
    state.egress = null;
    if (!state.closed) post({ type: "egress-closed", peerId: state.id });
  };
}

function descriptionFingerprint(description: RTCSessionDescription | null): string {
  const fingerprint = sdpFingerprint(description?.sdp);
  if (!fingerprint) throw new Error("The WebRTC DTLS fingerprint is unavailable.");
  return fingerprint;
}

function sdpFingerprint(sdp: string | undefined): string | undefined {
  return sdp
    ?.match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/imu)?.[1]
    ?.trim()
    .toUpperCase();
}

async function sendChannelPayload(
  state: PeerState,
  channel: RTCDataChannel,
  data: string | ArrayBuffer,
): Promise<void> {
  const maximumMessageSize = state.peerConnection?.sctp?.maxMessageSize ?? Number.POSITIVE_INFINITY;
  for (const frame of encodeTeamWebRtcPayload(data, maximumMessageSize)) {
    await waitForWritableChannel(channel);
    if (isString(frame)) channel.send(frame);
    else channel.send(frame);
  }
}

function waitForWritableChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= 4 * 1024 * 1024) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.removeEventListener("bufferedamountlow", onLow);
      reject(new Error(sourceText("error.remote.channelBackpressure")));
    }, 60_000);
    const onLow = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) onLow();
  });
}

async function restartIce(state: PeerState): Promise<void> {
  const connection = state.peerConnection;
  if (!connection || !state.connectionId || state.role !== "client") return;
  if (++state.iceRestarts > maximumIceRestarts) return dropConnection(state);
  connection.restartIce();
  const offer = await connection.createOffer({ iceRestart: true });
  await connection.setLocalDescription(offer);
  sendSignal(state, {
    type: "offer",
    version: SIGNAL_PROTOCOL_VERSION,
    connectionId: state.connectionId,
    channel: "team",
    sdp: requiredDescriptionSdp(offer),
  });
}

async function retryPendingIceRestart(state: PeerState): Promise<void> {
  if (
    !state.iceRestartPending ||
    state.iceRestarting ||
    state.closed ||
    state.role !== "client" ||
    !state.peerConnection ||
    !state.connectionId ||
    state.socket?.readyState !== WebSocket.OPEN
  )
    return;
  state.iceRestarting = true;
  state.iceRestartPending = false;
  try {
    await restartIce(state);
  } catch {
    state.iceRestartPending = true;
  } finally {
    state.iceRestarting = false;
  }
}

function restartsIce(connection: RTCPeerConnection, offer: string): boolean {
  const current = connection.remoteDescription?.sdp;
  return current !== undefined && iceUfrag(current) !== iceUfrag(offer);
}

function iceUfrag(sdp: string): string | undefined {
  return sdp.match(/^a=ice-ufrag:(\S+)$/mu)?.[1];
}

function usableIceServers(state: PeerState): RTCIceServer[] {
  return state.privateNetwork ? [] : state.iceServers;
}

function setPrivateNetwork(host: PeerState, privateNetwork: boolean): void {
  if (host.role !== "host" || host.signalHost || host.privateNetwork === privateNetwork) return;
  host.privateNetwork = privateNetwork;
  for (const client of [...host.clients.values()]) {
    client.privateNetwork = privateNetwork;
    if (privateNetwork) dropConnection(client);
  }
  post({ type: "ice-servers", peerId: host.id, iceServers: usableIceServers(host) });
}

function dropConnection(state: PeerState): void {
  if (state.signalHost) {
    disconnect(state.id);
    return;
  }
  clearPathRecovery(state);
  disconnectPeerConnection(state);
  post({ type: "peer-disconnected", peerId: state.id });
}

function recoverPath(state: PeerState, connection: RTCPeerConnection): void {
  if (state.role !== "client" || state.closed || state.disconnectedTimer !== null) return;
  const lost = () => !state.closed && state.peerConnection === connection && connection.connectionState !== "connected";
  state.signalRenewTimer = window.setTimeout(() => {
    state.signalRenewTimer = null;
    if (lost()) replaceSignal(state);
  }, SIGNAL_RENEW_DELAY_MS);
  state.disconnectedTimer = window.setTimeout(() => {
    state.disconnectedTimer = null;
    if (!lost()) return;
    disconnect(state.id);
    post({ type: "peer-disconnected", peerId: state.id });
  }, DISCONNECT_GRACE_MS);
}

function clearPathRecovery(state: PeerState): void {
  if (state.signalRenewTimer !== null) clearTimeout(state.signalRenewTimer);
  if (state.disconnectedTimer !== null) clearTimeout(state.disconnectedTimer);
  state.signalRenewTimer = null;
  state.disconnectedTimer = null;
}

function requiredDescriptionSdp(description: RTCSessionDescriptionInit): string {
  if (!isString(description.sdp)) throw new Error("WebRTC did not create a session description.");
  return description.sdp;
}

async function reportSelectedPath(state: PeerState, connection: RTCPeerConnection): Promise<void> {
  post({ type: "ice-path", peerId: state.id, side: state.role, ...(await selectedPath(connection)) });
}

async function selectedPath(connection: RTCPeerConnection): Promise<{ path: "relay" | "p2p"; route: string }> {
  const stats = await connection.getStats();
  const transport = [...stats.values()].find((report) => report.type === "transport" && report.selectedCandidatePairId);
  const selectedPair = transport ? stats.get(transport.selectedCandidatePairId) : null;
  const pair =
    selectedPair ??
    [...stats.values()].find(
      (report) => report.type === "candidate-pair" && report.state === "succeeded" && report.nominated,
    ) ??
    [...stats.values()].find((report) => report.type === "candidate-pair" && report.state === "succeeded");
  const local = pair ? stats.get(pair.localCandidateId) : null;
  const remote = pair ? stats.get(pair.remoteCandidateId) : null;
  return {
    path: local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "p2p",
    route: iceCandidateRoute(local, remote),
  };
}

function sendSignal(state: PeerState, message: SignalClientMessage): void {
  const socket = (state.signalHost ?? state).socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(sourceText("error.remote.signalNotConnected"));
  socket.send(JSON.stringify(message));
}

function replaceSignal(state: PeerState): void {
  if (state.closed) return;
  if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.restartIceOnReady = true;
  clearSignalLiveness(state);
  const socket = state.socket;
  state.socket = null;
  socket?.close(1000, "Network changed");
  connectSignal(state);
}

function scheduleSignalReconnect(state: PeerState): void {
  if (state.reconnectTimer !== null) return;
  const attempt = state.reconnectAttempt++;
  const holdMs = signalRetryAt - Date.now();
  const delay = Math.max(
    holdMs > 0 ? holdMs + Math.random() * SIGNAL_HOLD_SPREAD_MS : 0,
    attempt === 0 ? 500 + Math.random() * 3_500 : Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2),
  );
  if (holdMs > 0) post({ type: "signal-held", peerId: state.id, retryInMs: Math.ceil(delay) });
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    connectSignal(state);
  }, delay);
}

function awaitSignalReady(state: PeerState, socket: WebSocket): void {
  if (state.role !== "host") return;
  clearSignalLiveness(state);
  state.signalReadyTimer = window.setTimeout(() => {
    state.signalReadyTimer = null;
    if (state.closed || state.socket !== socket) return;
    state.socket = null;
    socket.close(1000, "No ready");
    post({ type: "signal-closed", peerId: state.id, code: SIGNAL_NO_READY_CLOSE_CODE, terminal: false });
    scheduleSignalReconnect(state);
  }, SIGNAL_READY_DEADLINE_MS);
}

function probeSignalLater(state: PeerState): void {
  if (state.role !== "host") return;
  clearSignalLiveness(state);
  const socket = state.socket;
  state.signalProbeTimer = window.setTimeout(() => {
    state.signalProbeTimer = null;
    if (state.closed || !socket || state.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    sendSignal(state, { type: "turn-refresh", version: SIGNAL_PROTOCOL_VERSION, connectionId: null });
    awaitSignalReady(state, socket);
  }, SIGNAL_PROBE_INTERVAL_MS);
}

function clearSignalLiveness(state: PeerState): void {
  if (state.signalReadyTimer !== null) clearTimeout(state.signalReadyTimer);
  if (state.signalProbeTimer !== null) clearTimeout(state.signalProbeTimer);
  state.signalReadyTimer = null;
  state.signalProbeTimer = null;
}

function scheduleTurnRefresh(state: PeerState, delay = SIGNAL_TURN_REFRESH_INTERVAL_MS): void {
  state.turnRefreshDueAt = Date.now() + delay;
  armTurnRefresh(state, delay);
}

function armTurnRefresh(state: PeerState, delay: number): void {
  if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
  state.turnRefreshTimer = window.setTimeout(() => {
    state.turnRefreshTimer = null;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN)
      return armTurnRefresh(state, SIGNAL_TURN_REFRESH_INTERVAL_MS);
    try {
      sendSignal(state, { type: "turn-refresh", version: SIGNAL_PROTOCOL_VERSION, connectionId: null });
    } catch {
      armTurnRefresh(state, SIGNAL_TURN_REFRESH_INTERVAL_MS);
    }
  }, delay);
}

function disconnect(peerId: string): void {
  dropPreparedSignal(peerId);
  const state = peers.get(peerId);
  if (!state) return;
  state.closed = true;
  for (const child of [...state.clients.values()]) disconnect(child.id);
  if (state.signalHost) {
    for (const [sessionId, child] of state.signalHost.clients) {
      if (child === state) state.signalHost.clients.delete(sessionId);
    }
  }
  if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
  if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
  clearSignalLiveness(state);
  clearPathRecovery(state);
  disconnectPeerConnection(state);
  state.socket?.close(1000, "Peer stopped");
  peers.delete(peerId);
  if (state.signalHost) post({ type: "peer-disconnected", peerId });
}

function disconnectPeerConnection(state: PeerState): void {
  const socket = (state.signalHost ?? state).socket;
  if (state.connectionId && socket?.readyState === WebSocket.OPEN) {
    const message: SignalClientMessage = {
      type: "disconnect",
      version: SIGNAL_PROTOCOL_VERSION,
      connectionId: state.connectionId,
    };
    socket.send(JSON.stringify(message));
  }
  const egress = state.egress;
  state.egress = null;
  egress?.close();
  if (egress && !state.closed) post({ type: "egress-closed", peerId: state.id });
  state.peerConnection?.close();
  state.peerConnection = null;
  state.connectionId = null;
  state.channels = {};
  for (const decoder of Object.values(state.payloadDecoders)) decoder?.reset();
  state.payloadDecoders = {};
}

function failSignalProtocol(state: PeerState): void {
  post({
    type: "peer-error",
    peerId: state.id,
    code: "protocol_error",
    message: sourceText("error.remote.signalFrameUnreadable"),
    terminal: true,
  });
  disconnect(state.id);
  post({ type: "peer-disconnected", peerId: state.id });
}

function failPeer(state: PeerState): void {
  post({
    type: "peer-error",
    peerId: state.id,
    code: "webrtc_error",
    message: sourceText("error.remote.webRtcFailed"),
  });
}

function holdSignalAfterClose(code: number, refusal: string | null): void {
  if (code === 1008 && (refusal === null || refusal === "rate_limited")) signalRetryAt = Date.now() + 60_000;
}

function signalErrorCode(data: unknown): string | null {
  if (!isString(data)) return null;
  try {
    const message = decodeSignalServerMessage(JSON.parse(data));
    return message?.type === "error" ? message.code : null;
  } catch {
    return null;
  }
}

function requirePeer(peerId: string): PeerState {
  const state = peers.get(peerId);
  if (!state) throw new Error("The WebRTC peer does not exist.");
  return state;
}

function channelKind(label: string): "rpc" | "events" | "files" | "desktop" | null {
  if (label === TEAM_PROTOCOL_V2_CHANNELS.rpc) return "rpc";
  if (label === TEAM_PROTOCOL_V2_CHANNELS.events) return "events";
  if (label === TEAM_PROTOCOL_V2_CHANNELS.files) return "files";
  if (label === "openbot.remote-desktop.signal.v1") return "desktop";
  return null;
}

function post(message: MainBridgeMessage): void {
  mainPort.postMessage(message);
}

function egressFrame(data: unknown): string | ArrayBuffer | null {
  return isString(data) || data instanceof ArrayBuffer ? data : null;
}
