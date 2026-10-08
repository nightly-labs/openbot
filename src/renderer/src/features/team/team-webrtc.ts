import { isString } from "@openbot/contracts/runtime-values";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_TURN_REFRESH_INTERVAL_MS,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
import { TEAM_PROTOCOL_V2_CHANNELS } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./team-webrtc-framing";

export interface BridgeCommand {
  commandId: string;
  type: "connect" | "prepare-signal" | "disconnect" | "disconnect-peer" | "send" | "restart-ice" | "close";
  peerId: string;
  signalUrl?: string;
  token?: string;
  peer?: "host" | "client";
  iceTransportPolicy?: "all" | "relay";
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
  code?: string;
  message?: string;
  connectionId?: string | null;
  sessionId?: string;
  userId?: string;
  membershipId?: string;
  role?: "owner" | "admin" | "member";
  sessionExpiresAt?: number;
  localFingerprint?: string;
  remoteFingerprint?: string;
  iceServers?: RTCIceServer[];
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
  channels: Partial<Record<"rpc" | "events" | "files" | "desktop", RTCDataChannel>>;
  payloadDecoders: Partial<Record<"rpc" | "events" | "files" | "desktop", TeamWebRtcPayloadDecoder>>;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  turnRefreshTimer: number | null;
  /** Opens a new Signal socket when a lost path did not come back. */
  signalRenewTimer: number | null;
  /** Reports a lost path that did not come back as a disconnected peer. */
  disconnectedTimer: number | null;
  iceRestartPending: boolean;
  iceRestarting: boolean;
  iceRestarts: number;
  signalChain: Promise<void>;
  closed: boolean;
}

// After a sleep or a network change the path can stay `disconnected` or `failed`. The ICE restart
// offer goes to the Signal socket from before, which can be half-open, so no answer comes. A new
// socket restarts ICE on its `ready`; when the path is still lost after the grace time, main
// connects again with a new ticket. Before this, main read the peer as connected until a restart.
const SIGNAL_RENEW_DELAY_MS = 8_000;
const DISCONNECT_GRACE_MS = 15_000;

const peers = new Map<string, PeerState>();

// A Signal socket opened while main waits for the ticket. Its TLS and WebSocket handshakes then do
// not wait for the ticket. Nothing is sent on it before `connect` names the same address and adds
// the hello; a socket that no `connect` takes closes.
interface PreparedSignal {
  signalUrl: string;
  socket: WebSocket;
  /** Signal said something before the hello, which is only a refusal. The socket is not used. */
  refused: boolean;
  timer: number;
  listeners: AbortController;
}
const PREPARED_SIGNAL_LIFETIME_MS = 30_000;
const preparedSignals = new Map<string, PreparedSignal>();
const dataChannelNames = ["rpc", "events", "files", "desktop"] as const;
// Chromium keeps the sockets of every earlier ICE generation until the connection closes: one per
// network interface, and one more per interface for TURN, for each restart. On a host with 10
// interfaces, about 150 restarts reach the network service's limit of 3,000 sockets, and then no
// device can connect until the app restarts. A connection that would restart once more than this is
// dropped instead, and the client connects again on a new one.
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

// A socket that was open when the network went away still reads as open when it comes back, but
// Signal closed it within minutes. This end sends nothing on it for 45 minutes, so it does not see
// that, and every device reads the host as offline until the app restarts.
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
        channels: {},
        payloadDecoders: {},
        reconnectAttempt: 0,
        reconnectTimer: null,
        turnRefreshTimer: null,
        signalRenewTimer: null,
        disconnectedTimer: null,
        iceRestartPending: false,
        iceRestarting: false,
        iceRestarts: 0,
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
    } else if (command.type === "restart-ice") {
      await restartIce(requirePeer(command.peerId));
    } else if (command.type === "close") {
      for (const peerId of [...preparedSignals.keys()]) dropPreparedSignal(peerId);
      for (const peerId of [...peers.keys()]) disconnect(peerId);
    }
    post({ type: "command-complete", commandId: command.commandId });
  } catch (error) {
    post({
      type: "command-error",
      commandId: command.commandId,
      message: error instanceof Error ? error.message : sourceText("error.remote.webRtcCommandFailed"),
    });
  }
}

function prepareSignal(peerId: string, signalUrl: string): void {
  // A peer that is already connecting has its own socket.
  if (peers.has(peerId)) return;
  dropPreparedSignal(peerId);
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
  socket.addEventListener(
    "message",
    () => {
      prepared.refused = true;
    },
    { signal: listeners.signal },
  );
  socket.addEventListener("close", drop, { signal: listeners.signal });
  socket.addEventListener("error", drop, { signal: listeners.signal });
  preparedSignals.set(peerId, prepared);
}

/** The prepared socket of a peer when it can carry the hello for `signalUrl`, and forgets it either way. */
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
  const socket = prepared ?? new WebSocket(state.signalUrl);
  state.socket = socket;
  const sendHello = () => {
    state.reconnectAttempt = 0;
    const hello: SignalClientMessage = {
      type: "hello",
      version: SIGNAL_PROTOCOL_VERSION,
      peer: state.role,
      token: state.resumeToken ?? state.token,
      ...(state.role === "host" ? { multiplex: true } : {}),
    };
    socket.send(JSON.stringify(hello));
  };
  // A prepared socket can be open already. It told main when it opened.
  const open = prepared?.readyState === WebSocket.OPEN;
  if (!open)
    socket.addEventListener("open", () => {
      post({ type: "signal-open", peerId: state.id });
      sendHello();
    });
  socket.addEventListener("message", (event) => {
    if (!isString(event.data)) return;
    state.signalChain = state.signalChain
      .then(async () => {
        if (state.closed || state.socket !== socket) return;
        let message: SignalServerMessage | null;
        try {
          message = decodeSignalServerMessage(JSON.parse(event.data));
        } catch (error) {
          return failSignalProtocol(state, error);
        }
        // A frame type this build does not know is a newer Signal service, not a broken connection.
        if (message) await handleSignal(state, message);
      })
      // Only what handling a frame this peer did read can throw -- an ICE or SDP operation the
      // browser refused. That is a connection failing, which a reconnect can still fix.
      .catch((error) => failPeer(state, error));
  });
  socket.addEventListener("close", (event) => {
    if (state.socket !== socket) return;
    state.socket = null;
    if (event.code === 4000) {
      disconnect(state.id);
      post({ type: "peer-disconnected", peerId: state.id });
      return;
    }
    if (!state.closed) scheduleSignalReconnect(state);
  });
  socket.addEventListener("error", () => socket.close());
  if (open) sendHello();
}

async function handleSignal(state: PeerState, message: SignalServerMessage): Promise<void> {
  // Signal sends Slack and Discord messages only to the main process's `ingress` socket, never to this peer.
  if (
    message.type === "slack-delivery" ||
    message.type === "discord-session" ||
    message.type === "discord-delivery" ||
    message.type === "webhook-ready" ||
    message.type === "webhook-delivery"
  )
    return;
  if (message.type === "account-profile-changed") {
    post({ type: "account-profile-changed", peerId: state.id });
    return;
  }
  if (message.type === "account-servers-changed") {
    post({ type: "account-servers-changed", peerId: state.id });
    return;
  }
  if (message.type === "error") {
    post({
      type: "peer-error",
      peerId: state.id,
      code: message.code,
      message: message.message,
    });
    // Signal sends `permission_denied` to a host for a relayed frame whose connection it already
    // removed, such as a late ICE candidate after a phone reconnected. That connection is gone; the
    // host registration that serves every other device is not.
    const staleRelay = message.code === "permission_denied" && state.role === "host";
    if (
      message.code === "session_revoked" ||
      message.code === "authentication_required" ||
      (message.code === "permission_denied" && !staleRelay) ||
      message.code === "host_busy"
    ) {
      disconnect(state.id);
      post({ type: "peer-disconnected", peerId: state.id });
    }
    return;
  }
  if (message.type === "ready") {
    const shouldRestartWithRefreshedTurn = Boolean(
      state.role === "client" && state.connectionId && state.peerConnection,
    );
    state.resumeToken = message.resumeToken;
    // Null on the `ready` that answers a TURN refresh: new credentials for the connection already
    // open, not a new connection.
    state.connectionId = message.connectionId ?? state.connectionId;
    state.iceServers = message.iceServers;
    for (const client of state.clients.values()) {
      client.iceServers = state.iceServers;
      client.peerConnection?.setConfiguration({
        iceServers: client.iceServers,
        bundlePolicy: "max-bundle",
        iceTransportPolicy: client.iceTransportPolicy,
      });
      post({ type: "ice-servers", peerId: client.id, iceServers: client.iceServers });
    }
    if (state.peerConnection)
      state.peerConnection.setConfiguration({
        iceServers: state.iceServers,
        bundlePolicy: "max-bundle",
        iceTransportPolicy: state.iceTransportPolicy,
      });
    scheduleTurnRefresh(state);
    post({ type: "ice-servers", peerId: state.id, iceServers: state.iceServers });
    post({ type: "signal-ready", peerId: state.id });
    if (shouldRestartWithRefreshedTurn) state.iceRestartPending = true;
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
        signalRenewTimer: null,
        disconnectedTimer: null,
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
      try {
        await handleSignal(client, message);
      } catch (error) {
        failPeer(client, error);
        disconnect(client.id);
      }
    }
    return;
  }
  if (message.type === "disconnect" && message.connectionId === state.connectionId) {
    if (state.signalHost) {
      // Signal already removed the connection; do not echo a disconnect.
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
  // Everything left is a relayed negotiation frame, and only the team channel's is this peer's.
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
      dropRestartedConnection(state);
      return;
    }
    await connection.setRemoteDescription({ type: "offer", sdp: message.sdp });
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    sendSignal(state, {
      type: "answer",
      version: SIGNAL_PROTOCOL_VERSION,
      connectionId: message.connectionId,
      channel: "team",
      sdp: requiredDescriptionSdp(answer),
    });
  } else if (message.type === "answer") {
    await state.peerConnection?.setRemoteDescription({ type: "answer", sdp: message.sdp });
  } else if (message.type === "ice-candidate") {
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
    iceServers,
    bundlePolicy: "max-bundle",
    iceTransportPolicy: state.iceTransportPolicy,
  });
  state.peerConnection = connection;
  state.iceRestarts = 0;
  connection.onicecandidate = (event) => {
    if (!event.candidate || !state.connectionId) return;
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
    const channel = channelKind(event.channel.label);
    if (channel) bindDataChannel(state, channel, event.channel);
  };
  connection.onconnectionstatechange = () => {
    if (state.peerConnection !== connection) return;
    if (connection.connectionState === "connected") {
      clearPathRecovery(state);
      void reportSelectedPath(state, connection).catch(() => undefined);
    }
    if (connection.connectionState === "disconnected" || connection.connectionState === "failed")
      recoverPath(state, connection);
    if (connection.connectionState === "failed") {
      state.iceRestartPending = true;
      void retryPendingIceRestart(state);
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
      } catch (error) {
        failPeer(state, error);
      }
    }
  };
  channel.onmessage = (event) => {
    if (state.channels[kind] !== channel) return;
    try {
      const data = decoder.push(event.data);
      if (data !== undefined) post({ type: "data", peerId: state.id, channel: kind, data });
    } catch (error) {
      failPeer(state, error);
      disconnectPeerConnection(state);
      post({ type: "peer-disconnected", peerId: state.id });
    }
  };
  channel.onerror = () =>
    post({
      type: "peer-error",
      peerId: state.id,
      code: "data_channel_error",
      message: sourceText("error.remote.dataChannelFailed", { kind }),
    });
}

function descriptionFingerprint(description: RTCSessionDescription | null): string {
  const fingerprint = description?.sdp.match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/imu)?.[1]?.trim();
  if (!fingerprint) throw new Error("The WebRTC DTLS fingerprint is unavailable.");
  return fingerprint.toUpperCase();
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
  if (++state.iceRestarts > maximumIceRestarts) return dropRestartedConnection(state);
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

/** Whether an offer for a connection that already has a remote description starts a new ICE generation. */
function restartsIce(connection: RTCPeerConnection, offer: string): boolean {
  const current = connection.remoteDescription?.sdp;
  return current !== undefined && iceUfrag(current) !== iceUfrag(offer);
}

function iceUfrag(sdp: string): string | undefined {
  return sdp.match(/^a=ice-ufrag:(\S+)$/mu)?.[1];
}

/**
 * Closes a connection that has used up its ICE restarts. Signal tells the other end, which closes
 * its own connection, and the client connects again with a new one.
 */
function dropRestartedConnection(state: PeerState): void {
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
  const path = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "p2p";
  post({ type: "ice-path", peerId: state.id, path });
}

function sendSignal(state: PeerState, message: SignalClientMessage): void {
  const socket = (state.signalHost ?? state).socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(sourceText("error.remote.signalNotConnected"));
  socket.send(JSON.stringify(message));
}

/** Opens a new Signal socket now. The old one is detached first, so its close schedules nothing. */
function replaceSignal(state: PeerState): void {
  if (state.closed) return;
  if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.reconnectAttempt = 0;
  const socket = state.socket;
  state.socket = null;
  socket?.close(1000, "Network changed");
  connectSignal(state);
}

function scheduleSignalReconnect(state: PeerState): void {
  if (state.reconnectTimer !== null) return;
  const delay = Math.min(30_000, 500 * 2 ** state.reconnectAttempt++);
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    connectSignal(state);
  }, delay);
}

function scheduleTurnRefresh(state: PeerState): void {
  if (state.turnRefreshTimer !== null) clearTimeout(state.turnRefreshTimer);
  state.turnRefreshTimer = window.setTimeout(() => {
    state.turnRefreshTimer = null;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return scheduleTurnRefresh(state);
    try {
      sendSignal(state, { type: "turn-refresh", version: SIGNAL_PROTOCOL_VERSION, connectionId: state.connectionId });
    } catch {
      scheduleTurnRefresh(state);
    }
  }, SIGNAL_TURN_REFRESH_INTERVAL_MS);
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
  state.peerConnection?.close();
  state.peerConnection = null;
  state.connectionId = null;
  state.channels = {};
  for (const decoder of Object.values(state.payloadDecoders)) decoder?.reset();
  state.payloadDecoders = {};
}

// A malformed known frame is where the two ends stop agreeing about the wire, so it is a
// `protocol_error` rather than a WebRTC failure and the connection does not survive it: this frame
// was meant to set state the next one builds on, and the service would send the same bytes to a
// reconnect. `classifyTransportError` suspends reconnection for this code and leaves the server
// `incompatible`, which is the honest report -- `webrtc_error` reads as `network_unavailable` and
// retries forever. `disconnect` closes the socket and clears the reconnect timer, and only posts
// `peer-disconnected` for a child peer; the peer that owns a socket is never one.
function failSignalProtocol(state: PeerState, error: unknown): void {
  post({
    type: "peer-error",
    peerId: state.id,
    code: "protocol_error",
    message: error instanceof Error ? error.message : sourceText("error.remote.signalFrameUnreadable"),
  });
  disconnect(state.id);
  post({ type: "peer-disconnected", peerId: state.id });
}

function failPeer(state: PeerState, error: unknown): void {
  post({
    type: "peer-error",
    peerId: state.id,
    code: "webrtc_error",
    message: error instanceof Error ? error.message : sourceText("error.remote.webRtcFailed"),
  });
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
