import type { SignalServerMessage } from "@openbot/contracts/signal-protocol/messages";
import { TEAM_PROTOCOL_V2_CHANNELS } from "@openbot/contracts/team-protocol/v2";
import { afterEach, expect, it, type Mock, vi } from "vitest";
import type { BridgeCommand } from "./team-webrtc";

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
  static readonly OPEN = 1;
  static readonly instances: SignalSocket[] = [];
  readyState = 1;
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn();
  constructor() {
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
  onicecandidate: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly close = vi.fn();
  readonly setConfiguration = vi.fn();
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
