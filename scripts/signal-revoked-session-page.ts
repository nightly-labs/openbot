import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import type { SignalClientMessage, SignalServerMessage } from "@openbot/contracts/signal-protocol/messages";
import { TEAM_PROTOCOL_V2_CHANNELS } from "@openbot/contracts/team-protocol/webrtc-framing";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "@openbot/team-client";
import { type BridgeCommand, CLIENT_RECONFIRM_MS } from "../src/renderer/src/features/team/team-webrtc";
import { advanceClock, realClearTimeout, realSetTimeout } from "./signal-revoked-session-clock";

interface BridgeEvent {
  type: string;
  commandId?: string;
  peerId?: string;
  code?: string;
  channel?: string;
  data?: string | ArrayBuffer;
  sessionId?: string;
  message?: string;
}

interface ScriptedClient {
  name: string;
  sessionId: string;
  socket: WebSocket | null;
  connectionId: string | null;
  resumeToken: string | null;
  connection: RTCPeerConnection | null;
  channels: Map<string, RTCDataChannel>;
  decoder: TeamWebRtcPayloadDecoder;
  readies: number;
  answers: number;
  replies: string[];
  signalErrors: string[];
  signalCloses: number[];
  rpcClosed: boolean;
}

const CHANNEL_LABELS = [
  TEAM_PROTOCOL_V2_CHANNELS.rpc,
  TEAM_PROTOCOL_V2_CHANNELS.events,
  TEAM_PROTOCOL_V2_CHANNELS.files,
  "openbot.remote-desktop.signal.v1",
];
const RPC_REPLY_PREFIX = "echo:";

const events: BridgeEvent[] = [];
const eventWaiters = new Set<() => void>();
const clients = new Map<string, ScriptedClient>();
const bridge = new MessageChannel();
let commandSequence = 0;

bridge.port1.onmessage = (event: MessageEvent<BridgeEvent>) => {
  const received = event.data;
  events.push(received);
  if (received.type === "data" && received.channel === "rpc" && received.peerId && typeof received.data === "string")
    void command({
      type: "send",
      peerId: received.peerId,
      channel: "rpc",
      data: `${RPC_REPLY_PREFIX}${received.data}`,
    }).catch(() => undefined);
  for (const wake of [...eventWaiters]) wake();
};
bridge.port1.start();
window.postMessage("openbot-team-webrtc-port", "*", [bridge.port2]);

function until<T>(read: () => T | undefined, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = read();
      if (value === undefined) return false;
      cleanup();
      resolve(value);
      return true;
    };
    const timer = realSetTimeout(() => {
      cleanup();
      reject(new Error(`Timed out: ${label}.`));
    }, milliseconds);
    const poll = window.setInterval(check, 100);
    const cleanup = () => {
      realClearTimeout(timer);
      clearInterval(poll);
      eventWaiters.delete(wake);
    };
    const wake = () => void check();
    eventWaiters.add(wake);
    check();
  });
}

async function command(fields: Omit<BridgeCommand, "commandId">): Promise<void> {
  commandSequence += 1;
  const commandId = `e2e-${commandSequence}`;
  bridge.port1.postMessage({ ...fields, commandId });
  const done = await until(
    () =>
      events.find(
        (event) =>
          event.commandId === commandId && (event.type === "command-complete" || event.type === "command-error"),
      ),
    30_000,
    `command ${fields.type}`,
  );
  if (done.type === "command-error") throw new Error(done.message ?? "Command failed.");
}

function requireClient(name: string): ScriptedClient {
  const client = clients.get(name);
  if (!client) throw new Error(`No client ${name}.`);
  return client;
}

function sendSignal(client: ScriptedClient, message: SignalClientMessage): void {
  if (client.socket?.readyState !== WebSocket.OPEN) throw new Error(`Signal of ${client.name} is not open.`);
  client.socket.send(JSON.stringify(message));
}

function createConnection(client: ScriptedClient): RTCPeerConnection {
  const connection = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
  client.connection = connection;
  connection.onicecandidate = (event) => {
    if (!event.candidate?.candidate || !client.connectionId) return;
    sendSignal(client, {
      type: "ice-candidate",
      version: 1,
      connectionId: client.connectionId,
      channel: "team",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  };
  for (const label of CHANNEL_LABELS) {
    const channel = connection.createDataChannel(label, { ordered: true });
    channel.binaryType = "arraybuffer";
    client.channels.set(label, channel);
    if (label === TEAM_PROTOCOL_V2_CHANNELS.rpc) {
      channel.onmessage = (event) => {
        const data = client.decoder.push(event.data);
        if (typeof data === "string") client.replies.push(data);
      };
      channel.onclose = () => {
        client.rpcClosed = true;
      };
    }
  }
  return connection;
}

async function offer(client: ScriptedClient): Promise<void> {
  const connection = client.connection;
  if (!connection || !client.connectionId) throw new Error(`No connection for ${client.name}.`);
  const description = await connection.createOffer();
  await connection.setLocalDescription(description);
  sendSignal(client, {
    type: "offer",
    version: 1,
    connectionId: client.connectionId,
    channel: "team",
    sdp: description.sdp ?? "",
  });
}

async function handleFrame(client: ScriptedClient, frame: SignalServerMessage): Promise<void> {
  if (frame.type === "ready") {
    client.readies += 1;
    client.resumeToken = frame.resumeToken;
    if (frame.connectionId !== null) {
      client.connectionId = frame.connectionId;
      if (!client.connection) {
        createConnection(client);
        await offer(client);
      }
    }
  } else if (frame.type === "answer" && frame.connectionId === client.connectionId) {
    client.answers += 1;
    await client.connection?.setRemoteDescription({ type: "answer", sdp: frame.sdp });
  } else if (frame.type === "offer" && frame.connectionId === client.connectionId && client.connection) {
    await client.connection.setRemoteDescription({ type: "offer", sdp: frame.sdp });
    const answer = await client.connection.createAnswer();
    await client.connection.setLocalDescription(answer);
    sendSignal(client, {
      type: "answer",
      version: 1,
      connectionId: frame.connectionId,
      channel: "team",
      sdp: answer.sdp ?? "",
    });
  } else if (frame.type === "ice-candidate" && frame.connectionId === client.connectionId) {
    await client.connection?.addIceCandidate({
      candidate: frame.candidate,
      sdpMid: frame.sdpMid,
      sdpMLineIndex: frame.sdpMLineIndex,
    });
  } else if (frame.type === "error") {
    client.signalErrors.push(frame.code);
  }
}

function openSignal(client: ScriptedClient, signalUrl: string, token: string, waitForHost: boolean): void {
  const socket = new WebSocket(signalUrl);
  client.socket = socket;
  let chain = Promise.resolve();
  socket.onopen = () => {
    const hello: SignalClientMessage = {
      type: "hello",
      version: 1,
      peer: "client",
      token,
      ...(waitForHost ? { waitForHost } : {}),
    };
    socket.send(JSON.stringify(hello));
  };
  socket.onmessage = (event) => {
    const frame = decodeSignalServerMessage(JSON.parse(String(event.data)));
    if (frame) chain = chain.then(() => handleFrame(client, frame)).catch(() => undefined);
  };
  socket.onclose = (event) => {
    client.signalCloses.push(event.code);
    if (client.socket === socket) client.socket = null;
  };
}

const e2e = {
  async startBridge(): Promise<void> {
    await until(() => events.find((event) => event.type === "bridge-ready"), 10_000, "bridge ready");
  },
  async connectHost(hostId: string, signalUrl: string, token: string): Promise<void> {
    const from = events.length;
    await command({ type: "connect", peerId: hostId, signalUrl, token, peer: "host", iceTransportPolicy: "all" });
    await until(
      () => events.slice(from).find((event) => event.type === "signal-ready" && event.peerId === hostId),
      15_000,
      "host signal ready",
    );
  },
  advancePastReconfirm(): number {
    return advanceClock(CLIENT_RECONFIRM_MS + 1_000);
  },
  mark(): number {
    return events.length;
  },
  async waitHostEvent(
    from: number,
    match: { type: string; peerId?: string; code?: string; sessionId?: string },
    milliseconds: number,
  ): Promise<BridgeEvent> {
    return until(
      () =>
        events
          .slice(from)
          .find(
            (event) =>
              event.type === match.type &&
              (match.peerId === undefined || event.peerId === match.peerId) &&
              (match.code === undefined || event.code === match.code) &&
              (match.sessionId === undefined || event.sessionId === match.sessionId),
          ),
      milliseconds,
      `host event ${match.type}`,
    );
  },
  hostEvents(from: number): Array<{ type: string; peerId?: string; code?: string }> {
    return events
      .slice(from)
      .filter((event) => event.type !== "data" && event.type !== "command-complete")
      .map(({ type, peerId, code }) => ({ type, peerId, code }));
  },
  async connectClient(name: string, sessionId: string, signalUrl: string, token: string): Promise<string> {
    const client: ScriptedClient = {
      name,
      sessionId,
      socket: null,
      connectionId: null,
      resumeToken: null,
      connection: null,
      channels: new Map(),
      decoder: new TeamWebRtcPayloadDecoder(),
      readies: 0,
      answers: 0,
      replies: [],
      signalErrors: [],
      signalCloses: [],
      rpcClosed: false,
    };
    clients.set(name, client);
    const from = events.length;
    openSignal(client, signalUrl, token, false);
    await until(
      () => ([...client.channels.values()].every((channel) => channel.readyState === "open") ? true : undefined),
      20_000,
      `${name} data channels open`,
    );
    const incoming = await until(
      () => events.slice(from).find((event) => event.type === "peer-connected"),
      10_000,
      `${name} host peer connected`,
    );
    return String(incoming.peerId);
  },
  async reconnectClientSignal(name: string, signalUrl: string): Promise<void> {
    const client = requireClient(name);
    if (!client.resumeToken) throw new Error(`No resume token for ${name}.`);
    const readies = client.readies;
    openSignal(client, signalUrl, client.resumeToken, true);
    await until(() => (client.readies > readies ? true : undefined), 20_000, `${name} signal ready again`);
  },
  async rpc(name: string, text: string, milliseconds: number): Promise<boolean> {
    const client = requireClient(name);
    const channel = client.channels.get(TEAM_PROTOCOL_V2_CHANNELS.rpc);
    if (channel?.readyState !== "open") return false;
    const maximum = client.connection?.sctp?.maxMessageSize ?? Number.POSITIVE_INFINITY;
    for (const frame of encodeTeamWebRtcPayload(text, maximum)) {
      if (typeof frame === "string") channel.send(frame);
      else channel.send(frame);
    }
    return until(
      () => (client.replies.includes(`${RPC_REPLY_PREFIX}${text}`) ? true : undefined),
      milliseconds,
      `${name} rpc reply`,
    ).catch(() => false);
  },
  async turnRefreshBurst(name: string, count: number): Promise<void> {
    const client = requireClient(name);
    const readies = client.readies;
    for (let index = 0; index < count; index += 1)
      sendSignal(client, { type: "turn-refresh", version: 1, connectionId: null });
    await until(() => (client.readies >= readies + count ? true : undefined), 20_000, `${name} turn refresh burst`);
  },
  async renegotiate(name: string, milliseconds: number): Promise<boolean> {
    const client = requireClient(name);
    const answers = client.answers;
    await offer(client);
    return until(() => (client.answers > answers ? true : undefined), milliseconds, `${name} answer`).catch(
      () => false,
    );
  },
  async waitRpcClosed(name: string, milliseconds: number): Promise<boolean> {
    const client = requireClient(name);
    return until(() => (client.rpcClosed ? true : undefined), milliseconds, `${name} rpc closed`).catch(() => false);
  },
  async waitSignalClosed(name: string, milliseconds: number): Promise<number> {
    const client = requireClient(name);
    const closes = client.signalCloses.length;
    if (!client.socket) return client.signalCloses.at(-1) ?? 0;
    return until(
      () => (client.signalCloses.length > closes ? client.signalCloses.at(-1) : undefined),
      milliseconds,
      `${name} signal closed`,
    );
  },
  hello(
    signalUrl: string,
    token: string,
    milliseconds: number,
  ): Promise<{ type: string; code?: string; closeCode?: number }> {
    return new Promise((resolve) => {
      const socket = new WebSocket(signalUrl);
      const finish = (result: { type: string; code?: string; closeCode?: number }) => {
        realClearTimeout(timer);
        socket.onclose = null;
        socket.close();
        resolve(result);
      };
      const timer = realSetTimeout(() => finish({ type: "timeout" }), milliseconds);
      socket.onopen = () => {
        const hello: SignalClientMessage = { type: "hello", version: 1, peer: "client", token };
        socket.send(JSON.stringify(hello));
      };
      socket.onmessage = (event) => {
        const frame = decodeSignalServerMessage(JSON.parse(String(event.data)));
        if (frame?.type === "error") finish({ type: frame.type, code: frame.code });
        else if (frame) finish({ type: frame.type });
      };
      socket.onclose = (event) => finish({ type: "closed", closeCode: event.code });
    });
  },
  clientState(name: string): { rpc: string; signalErrors: string[]; signalCloses: number[]; signalOpen: boolean } {
    const client = requireClient(name);
    return {
      rpc: client.channels.get(TEAM_PROTOCOL_V2_CHANNELS.rpc)?.readyState ?? "none",
      signalErrors: client.signalErrors,
      signalCloses: client.signalCloses,
      signalOpen: client.socket?.readyState === WebSocket.OPEN,
    };
  },
};

Object.assign(window, { e2e });
