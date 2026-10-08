import { isString } from "@openbot/contracts/runtime-values";
import type { SignalServerMessage } from "@openbot/contracts/signal-protocol/messages";
import { TEAM_PROTOCOL_V2_CHANNELS } from "@openbot/contracts/team-protocol/v2";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BridgeCommand } from "./team-webrtc";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./team-webrtc-framing";

// The previously untested boundary is the hidden renderer's actual MessagePort
// routing: each authenticated Signal connection must own a separate RTC peer.
interface PostedMessage {
  type: string;
  peerId?: string;
  hostId?: string;
  commandId?: string;
  channel?: string;
  code?: string;
  data?: string | ArrayBuffer;
}

interface TestPort {
  postMessage: Mock<(message: PostedMessage) => void>;
  start: () => void;
  onmessage: ((event: { data: BridgeCommand }) => void) | null;
}

class SignalSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly instances: SignalSocket[] = [];
  readyState = 1;
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn();
  constructor(readonly url = "") {
    super();
    SignalSocket.instances.push(this);
  }
  message(data: SignalServerMessage): void {
    this.raw(JSON.stringify(data));
  }
  // What a service that is not this protocol sends, which `SignalServerMessage` cannot describe.
  raw(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class DataChannel {
  binaryType = "arraybuffer";
  bufferedAmountLowThreshold = 0;
  bufferedAmount = 0;
  readyState = "open";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = vi.fn();
  constructor(readonly label: string) {}
}

class PeerConnection {
  static readonly instances: PeerConnection[] = [];
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  ondatachannel: ((event: { channel: DataChannel }) => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = "new";
  readonly close = vi.fn();
  readonly setConfiguration = vi.fn();
  readonly restartIce = vi.fn();
  constructor() {
    PeerConnection.instances.push(this);
  }
  async setLocalDescription(value: { type: string; sdp: string }): Promise<void> {
    this.localDescription = value;
  }
  async setRemoteDescription(value: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = value;
  }
  async createAnswer() {
    return { type: "answer", sdp: "a=fingerprint:sha-256 HOST" };
  }
  async createOffer() {
    return { type: "offer", sdp: "a=fingerprint:sha-256 CLIENT" };
  }
  createDataChannel(label: string): DataChannel {
    return new DataChannel(label);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  SignalSocket.instances.length = 0;
  PeerConnection.instances.length = 0;
});

async function startBridge() {
  vi.resetModules();
  const port: TestPort = {
    postMessage: vi.fn<(message: PostedMessage) => void>(),
    start: vi.fn(),
    onmessage: null,
  };
  const addEventListener =
    vi.fn<
      (type: string, listener: (event: { source: object; data: string; ports: (typeof port)[] }) => void) => void
    >();
  const testWindow = { addEventListener, removeEventListener: vi.fn(), setTimeout, clearTimeout };
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("WebSocket", SignalSocket);
  vi.stubGlobal("RTCPeerConnection", PeerConnection);
  await import("./team-webrtc");
  addEventListener.mock.calls[0]?.[1]({ source: testWindow, data: "openbot-team-webrtc-port", ports: [port] });
  const posted = (type: string) =>
    port.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type);
  const command = async (data: Omit<BridgeCommand, "commandId">) => {
    const commandId = crypto.randomUUID();
    port.onmessage?.({ data: { ...data, commandId } });
    await vi.waitFor(() =>
      expect(posted("command-complete").some((message) => message.commandId === commandId)).toBe(true),
    );
  };
  return { posted, command };
}

it("routes two phones independently and disconnects or resumes only the addressed session", async () => {
  vi.useFakeTimers();
  const { posted, command } = await startBridge();
  await command({
    type: "connect",
    peerId: "host-1",
    peer: "host",
    signalUrl: "wss://signal.example.test",
    token: "test",
    iceTransportPolicy: "all",
  });
  const signal = SignalSocket.instances[0];
  if (!signal) throw new Error("No Signal socket.");
  signal.dispatchEvent(new Event("open"));
  expect(JSON.parse(signal.send.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
    type: "hello",
    peer: "host",
    multiplex: true,
  });
  signal.send.mockClear();
  signal.message({ type: "ready", version: 1, connectionId: null, resumeToken: "resume", iceServers: [] });
  signal.message({ type: "account-profile-changed", version: 1 });
  await vi.waitFor(() =>
    expect(posted("account-profile-changed")).toEqual([{ type: "account-profile-changed", peerId: "host-1" }]),
  );
  signal.message({ type: "account-servers-changed", version: 1 });
  await vi.waitFor(() =>
    expect(posted("account-servers-changed")).toEqual([{ type: "account-servers-changed", peerId: "host-1" }]),
  );
  for (const index of [1, 2])
    signal.message({
      type: "peer-ready",
      version: 1,
      connectionId: `connection-${index}`,
      sessionId: `session-${index}`,
      userId: "same-user",
      membershipId: "same-membership",
      role: "owner",
      sessionExpiresAt: 8_640_000_000_000,
      resumed: false,
    });
  await vi.waitFor(() => expect(posted("incoming-peer")).toHaveLength(2));
  const [first, second] = posted("incoming-peer");
  if (!first?.peerId || !second?.peerId) throw new Error("Each incoming phone needs a routing ID.");
  expect(first?.hostId).toBe("host-1");
  expect(second?.hostId).toBe("host-1");
  expect(first?.peerId).toEqual(expect.any(String));
  expect(second?.peerId).not.toBe(first?.peerId);
  const [rtc1, rtc2] = PeerConnection.instances;
  if (!rtc1 || !rtc2) throw new Error("Each phone needs its own RTC connection.");
  expect(rtc1.close).not.toHaveBeenCalled();
  const candidate = {
    candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
  rtc1.onicecandidate?.({ candidate });
  rtc1.onicecandidate?.({ candidate: { ...candidate, candidate: "" } });
  rtc1.onicecandidate?.({ candidate: null });
  expect(signal.send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
    { type: "ice-candidate", version: 1, connectionId: "connection-1", channel: "team", ...candidate },
  ]);
  signal.send.mockClear();
  for (const index of [1, 2])
    signal.message({
      type: "offer",
      version: 1,
      channel: "team",
      connectionId: `connection-${index}`,
      sdp: `a=fingerprint:sha-256 PHONE-${index}`,
    });
  await vi.waitFor(() => expect(signal.send).toHaveBeenCalledTimes(2));
  expect(signal.send.mock.calls.map(([message]) => JSON.parse(message).connectionId)).toEqual([
    "connection-1",
    "connection-2",
  ]);
  const channels = [rtc1, rtc2].map((rtc) =>
    [...Object.values(TEAM_PROTOCOL_V2_CHANNELS), "openbot.remote-desktop.signal.v1"].map((label) => {
      const channel = new DataChannel(label);
      rtc.ondatachannel?.({ channel });
      return channel;
    }),
  );
  for (const channelSet of channels) channelSet.at(-1)?.onopen?.();
  expect(posted("peer-connected").map((message) => message.peerId)).toEqual([first?.peerId, second?.peerId]);
  await command({ type: "send", peerId: first?.peerId, channel: "rpc", data: "first-only" });
  expect(channels[0]?.[0]?.send).toHaveBeenCalledExactlyOnceWith("first-only");
  expect(channels[1]?.[0]?.send).not.toHaveBeenCalled();
  channels[1]?.[1]?.onmessage?.({ data: "second-event" });
  expect(posted("data")).toEqual([{ type: "data", peerId: second?.peerId, channel: "events", data: "second-event" }]);

  signal.message({
    type: "peer-ready",
    version: 1,
    connectionId: "resumed-2",
    sessionId: "session-2",
    userId: "same-user",
    membershipId: "same-membership",
    role: "owner",
    sessionExpiresAt: 8_640_000_000_000,
    resumed: true,
  });
  await vi.waitFor(() => expect(posted("incoming-peer")).toHaveLength(3));
  expect(posted("incoming-peer").at(-1)?.peerId).toBe(second?.peerId);
  expect(PeerConnection.instances).toHaveLength(2);
  await command({ type: "disconnect-peer", peerId: first?.peerId });
  expect(rtc1.close).toHaveBeenCalledOnce();
  expect(rtc2.close).not.toHaveBeenCalled();
  await command({ type: "send", peerId: second?.peerId, channel: "rpc", data: "still-connected" });
  expect(channels[1]?.[0]?.send).toHaveBeenCalledExactlyOnceWith("still-connected");
  expect(posted("peer-disconnected").map((message) => message.peerId)).toEqual([first?.peerId]);
  signal.message({
    type: "peer-ready",
    version: 1,
    connectionId: "repaired-1",
    sessionId: "new-login-1",
    userId: "same-user",
    membershipId: "same-membership",
    role: "owner",
    sessionExpiresAt: 8_640_000_000_000,
    resumed: false,
  });
  await vi.waitFor(() => expect(posted("incoming-peer")).toHaveLength(4));
  expect(PeerConnection.instances).toHaveLength(3);
  expect(rtc2.close).not.toHaveBeenCalled();
  expect(posted("incoming-peer").at(-1)?.peerId).not.toBe(second?.peerId);
  await command({ type: "close", peerId: "all" });
});

// The Signal wire is where a frame this build cannot read means the two ends disagree, not that the
// network dropped something. Reporting it as a WebRTC failure left the socket open and the code
// reading as retryable, so the peer stayed on a connection whose next frame builds on the one it
// could not use, and reconnected into the same service to be sent the same bytes again.
it("stops a peer that Signal sends a frame it cannot read", async () => {
  vi.useFakeTimers();
  const { posted, command } = await startBridge();
  await command({
    type: "connect",
    peerId: "client-1",
    peer: "client",
    signalUrl: "wss://signal.example.test",
    token: "test",
    iceTransportPolicy: "all",
  });
  const signal = SignalSocket.instances[0];
  if (!signal) throw new Error("No Signal socket.");
  signal.dispatchEvent(new Event("open"));

  // A known frame type carrying a resume token no session could have.
  signal.raw(JSON.stringify({ type: "ready", version: 1, connectionId: null, resumeToken: "", iceServers: [] }));

  await vi.waitFor(() => expect(posted("peer-error")).toHaveLength(1));
  expect(posted("peer-error")[0]).toMatchObject({ peerId: "client-1", code: "protocol_error" });
  expect(posted("peer-disconnected")).toHaveLength(1);
  expect(signal.close).toHaveBeenCalled();
});

// After a sleep the Signal socket can be half-open, so the ICE restart offer got no answer. The peer
// stayed `failed` while main read the host as connected, until the app restarted.
it("renews Signal for a lost client path, and reports the peer when the path does not come back", async () => {
  vi.useFakeTimers();
  const { posted, command } = await startBridge();
  await command({
    type: "connect",
    peerId: "host-1",
    peer: "client",
    signalUrl: "wss://signal.example.test",
    token: "test",
    iceTransportPolicy: "all",
  });
  const signal = SignalSocket.instances[0];
  if (!signal) throw new Error("No Signal socket.");
  signal.dispatchEvent(new Event("open"));
  signal.message({ type: "ready", version: 1, connectionId: "connection-1", resumeToken: "resume", iceServers: [] });
  await vi.waitFor(() => expect(PeerConnection.instances).toHaveLength(1));
  const rtc = PeerConnection.instances[0];
  if (!rtc) throw new Error("No RTC connection.");
  const setState = (state: string) => {
    rtc.connectionState = state;
    rtc.onconnectionstatechange?.();
  };

  setState("connected");
  setState("disconnected");
  setState("connected");
  await vi.advanceTimersByTimeAsync(20_000);
  expect(SignalSocket.instances).toHaveLength(1);
  expect(posted("peer-disconnected")).toEqual([]);

  setState("failed");
  await vi.advanceTimersByTimeAsync(8_000);
  expect(signal.close).toHaveBeenCalled();
  expect(SignalSocket.instances).toHaveLength(2);
  expect(posted("peer-disconnected")).toEqual([]);
  await vi.advanceTimersByTimeAsync(7_000);
  expect(posted("peer-disconnected")).toEqual([{ type: "peer-disconnected", peerId: "host-1" }]);
  expect(rtc.close).toHaveBeenCalled();
});

// Main opens the client's Signal socket while the account service makes the ticket, so the TLS and
// WebSocket handshakes do not wait for it. Nothing may go on that socket before the hello of the
// ticket, and only a `connect` to the same address may use it.
describe("prepared Signal socket", () => {
  const signalUrl = "wss://signal.example.test/v1/signal";
  const connect = {
    type: "connect" as const,
    peerId: "host-1",
    peer: "client" as const,
    signalUrl,
    token: "ticket-1",
    iceTransportPolicy: "all" as const,
  };
  const hellos = (socket: SignalSocket) =>
    socket.send.mock.calls.map(([data]) => JSON.parse(data)).filter((message) => message.type === "hello");

  it("sends the hello of the ticket on the socket that opened before it", async () => {
    vi.useFakeTimers();
    const { posted, command } = await startBridge();
    await command({ type: "prepare-signal", peerId: "host-1", signalUrl });
    const prepared = SignalSocket.instances[0];
    if (!prepared) throw new Error("No Signal socket.");
    expect(prepared.url).toBe(signalUrl);
    prepared.dispatchEvent(new Event("open"));
    expect(posted("signal-open")).toEqual([{ type: "signal-open", peerId: "host-1" }]);
    expect(prepared.send).not.toHaveBeenCalled();

    await command(connect);
    expect(SignalSocket.instances).toHaveLength(1);
    expect(hellos(prepared)).toEqual([expect.objectContaining({ peer: "client", token: "ticket-1" })]);
    prepared.message({
      type: "ready",
      version: 1,
      connectionId: "connection-1",
      resumeToken: "resume",
      iceServers: [],
    });
    await vi.waitFor(() => expect(posted("signal-ready")).toHaveLength(1));
    // The lifetime of a prepared socket does not apply to one a peer uses.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prepared.close).not.toHaveBeenCalled();
  });

  it("sends the hello when a socket that is still opening opens", async () => {
    const { command } = await startBridge();
    await command({ type: "prepare-signal", peerId: "host-1", signalUrl });
    const prepared = SignalSocket.instances[0];
    if (!prepared) throw new Error("No Signal socket.");
    prepared.readyState = SignalSocket.CONNECTING;
    await command(connect);
    expect(prepared.send).not.toHaveBeenCalled();
    prepared.readyState = SignalSocket.OPEN;
    prepared.dispatchEvent(new Event("open"));
    expect(hellos(prepared)).toHaveLength(1);
    expect(SignalSocket.instances).toHaveLength(1);
  });

  it("does not use a socket of another address, or one that Signal already answered", async () => {
    const { command } = await startBridge();
    await command({ type: "prepare-signal", peerId: "host-1", signalUrl: "wss://old-signal.example.test/v1/signal" });
    const other = SignalSocket.instances[0];
    if (!other) throw new Error("No Signal socket.");
    await command(connect);
    expect(other.close).toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
    expect(SignalSocket.instances[1]?.url).toBe(signalUrl);

    await command({ type: "disconnect", peerId: "host-1" });
    await command({ type: "prepare-signal", peerId: "host-1", signalUrl });
    const refused = SignalSocket.instances[2];
    if (!refused) throw new Error("No Signal socket.");
    refused.message({ type: "error", version: 1, code: "rate_limited", message: "Too many." });
    await command(connect);
    expect(refused.close).toHaveBeenCalled();
    expect(refused.send).not.toHaveBeenCalled();
    expect(SignalSocket.instances).toHaveLength(4);
  });

  it("closes a socket that no connect takes", async () => {
    vi.useFakeTimers();
    const { command } = await startBridge();
    await command({ type: "prepare-signal", peerId: "host-1", signalUrl });
    await command({ type: "prepare-signal", peerId: "host-2", signalUrl });
    const [cancelled, unused] = SignalSocket.instances;
    if (!cancelled || !unused) throw new Error("No Signal socket.");
    await command({ type: "disconnect", peerId: "host-1" });
    expect(cancelled.close).toHaveBeenCalled();
    expect(unused.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(unused.close).toHaveBeenCalled();
    expect(unused.send).not.toHaveBeenCalled();
  });
});

describe("Team WebRTC payload framing", () => {
  it("fragments and restores text within the negotiated SCTP limit", () => {
    const frames = encodeTeamWebRtcPayload("remote payload ".repeat(100), 128, 7);
    const decoder = new TeamWebRtcPayloadDecoder();
    let decoded: string | ArrayBuffer | undefined;
    for (const frame of frames) {
      expect(isString(frame) ? frame.length : frame.byteLength).toBeLessThanOrEqual(128);
      decoded = decoder.push(frame);
    }
    expect(decoded).toBe("remote payload ".repeat(100));
  });

  it("frames binary payloads without changing their bytes", () => {
    const input = new Uint8Array(400);
    for (let index = 0; index < input.byteLength; index += 1) input[index] = index % 251;
    const decoder = new TeamWebRtcPayloadDecoder();
    let decoded: string | ArrayBuffer | undefined;
    for (const frame of encodeTeamWebRtcPayload(input.buffer, 96, 8)) decoded = decoder.push(frame);
    if (!(decoded instanceof ArrayBuffer)) throw new Error("Expected a binary WebRTC payload.");
    expect(new Uint8Array(decoded)).toEqual(input);
  });

  it("rejects non-contiguous fragments", () => {
    const frames = encodeTeamWebRtcPayload("x".repeat(300), 96, 9);
    const decoder = new TeamWebRtcPayloadDecoder();
    expect(decoder.push(requiredBinaryFrame(frames, 0))).toBeUndefined();
    expect(() => decoder.push(requiredBinaryFrame(frames, 2))).toThrow("contiguous");
  });
});

function requiredBinaryFrame(frames: Array<string | ArrayBuffer>, index: number): ArrayBuffer {
  const frame = frames[index];
  if (!(frame instanceof ArrayBuffer)) throw new Error("Expected a binary WebRTC frame.");
  return frame;
}
