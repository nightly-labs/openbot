import { Effect } from "effect";
import { authCall, CentralAuthOperationError } from "./central-auth-effects";
import { remoteCall } from "./remote-service-effects";
// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2AuthFrame,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol/v2";
import { describe, expect, it, vi } from "vitest";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";

const hostKeys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const channelBinding = { localFingerprint: "CLIENT-FINGERPRINT", remoteFingerprint: "HOST-FINGERPRINT" };
const listedHost = {
  hostId: "host-1",
  name: "Host",
  logoKey: null,
  devicePublicKey: hostKeys.publicKey,
  authEpoch: 1,
  membershipId: "member-1",
  role: "member" as const,
};

function mockAuthenticatedSend(bridge: TeamWebRtcBridge, automaticallyConfirm = true) {
  const pendingConfirmations: Array<() => void> = [];
  const send = vi.spyOn(bridge, "send").mockImplementation((hostId, channel, data) =>
    remoteCall(async () => {
      if (channel !== "rpc" || !isString(data)) return;
      let frame: TeamProtocolV2AuthFrame;
      try {
        frame = decodeTeamProtocolV2AuthFrame(data);
      } catch {
        return;
      }
      if (frame.type === "auth-complete") {
        const confirm = () =>
          bridge.emit(
            "data",
            hostId,
            "rpc",
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "auth-confirmed",
              clientNonce: frame.clientNonce,
              hostNonce: frame.hostNonce,
            }),
          );
        if (automaticallyConfirm) queueMicrotask(confirm);
        else pendingConfirmations.push(confirm);
        return;
      }
      if (frame.type !== "auth-init") return;
      const hostNonce = "h".repeat(43);
      const transcript = teamProtocolV2AuthenticationTranscript({
        hostId,
        sessionId: frame.ticket,
        ticket: frame.ticket,
        clientPublicKey: frame.clientPublicKey,
        clientNonce: frame.clientNonce,
        hostNonce,
        clientFingerprint: channelBinding.localFingerprint,
        hostFingerprint: channelBinding.remoteFingerprint,
      });
      queueMicrotask(() =>
        bridge.emit(
          "data",
          hostId,
          "rpc",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "auth-ready",
            clientNonce: frame.clientNonce,
            hostNonce,
            signature: sign(null, Buffer.from(transcript), hostKeys.privateKey).toString("base64url"),
          }),
        ),
      );
    }),
  );
  return {
    send,
    pendingConfirmations,
    confirmNext: () => pendingConfirmations.shift()?.(),
  };
}

// The control-plane half of the options is the same in every test and says nothing about any of
// them. Only the bridge and the session calls differ, so they stay at the call site.
function createTransport(
  bridge: TeamWebRtcBridge,
  overrides: Partial<ConstructorParameters<typeof TeamWebRtcClientTransport>[0]> = {},
): TeamWebRtcClientTransport {
  return new TeamWebRtcClientTransport({
    bridge,
    listHosts: () => authCall(async () => [listedHost]),
    startSession: () =>
      authCall(async () => ({ sessionId: "session-1", hostId: "host-1", expiresAt: Date.now() + 86_400_000 })),
    issueTicket: (sessionId: string) =>
      authCall(async () => ({
        ticket: sessionId,
        expiresAt: Date.now() + 180_000,
        signalUrl: "wss://signal.example.test/v1/signal",
      })),
    endSession: () => authCall(async () => undefined),
    createInvite: () =>
      authCall(async () => ({
        inviteId: "invite",
        token: "token",
        expiresAt: Date.now() + 60_000,
        permanent: false,
        useCount: 0,
      })),
    listInvites: () => authCall(async () => []),
    previewInvite: () =>
      authCall(async () => ({
        inviteId: "invite",
        hostId: "host-1",
        hostName: "Host",
        role: "member",
        expiresAt: Date.now() + 60_000,
        emailBound: false,
        permanent: false,
        devicePublicKey: null,
      })),
    acceptInvite: () => authCall(async () => ({ hostId: "host-1", membershipId: "member-1", role: "member" })),
    revokeInvite: () => authCall(async () => undefined),
    listMembers: () => authCall(async () => []),
    updateMember: () => authCall(async () => undefined),
    removeMember: () => authCall(async () => undefined),
    getPrincipalId: () => "user-1",
    controlPlaneUrl: "https://api.example.test",
    downloadHostLogo: () => authCall(async () => ({ bytes: new Uint8Array(), mimeType: "image/png" })),
    transferDirectory: join(tmpdir(), "openbot-webrtc-client-test"),
    ...overrides,
  });
}

function sentRequestId(send: { mock: { calls: unknown[][] } }): string | null {
  for (const call of [...send.mock.calls].reverse()) {
    if (call[1] !== "rpc" || !isString(call[2])) continue;
    try {
      const frame = decodeTeamProtocolV2RpcFrame(call[2]);
      if (frame.type === "request") return frame.requestId;
    } catch {
      // An auth frame, which this is not looking for.
    }
  }
  return null;
}

describe("TeamWebRtcClientTransport", () => {
  it("ends a pending mutation on stop without replaying it", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const authentication = mockAuthenticatedSend(bridge);
    const transport = createTransport(bridge);
    transport.pinHostKey("host-1", hostKeys.publicKey);
    try {
      await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
      const pending = Effect.runPromise(
        transport
          .request("host-1", "/v1/agents/research", { method: "DELETE" })
          .pipe(Effect.mapError((error) => error.cause)),
      );
      const failure = expect(pending).rejects.toMatchObject({ code: "remote_disconnected", status: 503 });
      await vi.waitFor(() => expect(sentRequestId(authentication.send)).not.toBeNull());
      const sentBeforeStop = authentication.send.mock.calls.length;
      await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
      await failure;
      expect(authentication.send.mock.calls.length).toBe(sentBeforeStop);
    } finally {
      await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
    }
  });

  it("reuses the logical session after a WebRTC disconnect", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    const authentication = mockAuthenticatedSend(bridge, false);
    const disconnectBridge = vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const startSession = vi
      .fn()
      .mockReturnValue(
        Effect.succeed({ sessionId: "session-1", hostId: "host-1", expiresAt: Date.now() + 86_400_000 }),
      );
    const issueTicket = vi.fn((sessionId: string, _clientPublicKey: string) =>
      Effect.succeed({
        ticket: sessionId,
        expiresAt: 2_000,
        signalUrl: "wss://signal.example.test/v1/signal",
      }),
    );
    const endSession = vi.fn().mockReturnValue(Effect.succeed(undefined));
    const transport = new TeamWebRtcClientTransport({
      bridge,
      listHosts: () => authCall(async () => [listedHost]),
      startSession,
      issueTicket,
      endSession,
      createInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          token: "token",
          expiresAt: 2_000,
          permanent: false,
          useCount: 0,
        })),
      listInvites: () => authCall(async () => []),
      previewInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          hostId: "host-1",
          hostName: "Host",
          role: "member",
          expiresAt: 2_000,
          emailBound: false,
          permanent: false,
          devicePublicKey: null,
        })),
      acceptInvite: () => authCall(async () => ({ hostId: "host-1", membershipId: "member-1", role: "member" })),
      revokeInvite: () => authCall(async () => undefined),
      listMembers: () => authCall(async () => []),
      updateMember: () => authCall(async () => undefined),
      removeMember: () => authCall(async () => undefined),
      getPrincipalId: () => "user-1",
      controlPlaneUrl: "https://api.example.test",
      downloadHostLogo: () => authCall(async () => ({ bytes: new Uint8Array(), mimeType: "image/png" })),
      transferDirectory: join(tmpdir(), "openbot-webrtc-client-test"),
    });
    await Effect.runPromise(transport.listHosts().pipe(Effect.mapError((error) => error.cause)));
    await expect(
      Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("pinned device key");
    expect(startSession).not.toHaveBeenCalled();
    transport.pinHostKey("host-1", hostKeys.publicKey);
    const protocolError = vi.fn();
    transport.on("error", protocolError);

    bridge.emit("connected", "host-1", channelBinding);
    bridge.emit("data", "host-1", "rpc", "host-gateway-data");
    bridge.emit("path", "host-1", "p2p");
    bridge.emit("error", "host-1", "data_channel_error", "host gateway event");
    bridge.emit("disconnected", "host-1");
    await Promise.resolve();
    expect(disconnectBridge).not.toHaveBeenCalled();
    expect(protocolError).not.toHaveBeenCalled();

    const initialConnection = Effect.runPromise(
      transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)),
    );
    await vi.waitFor(() => expect(authentication.pendingConfirmations).toHaveLength(1));
    expect(bridge.send).not.toHaveBeenCalledWith("host-1", "events", expect.any(String));
    authentication.confirmNext();
    await initialConnection;
    // What a caller asks before it decides whether the `connected` event it is waiting on is ever
    // coming: `connect` resolves on a channel that was already up without announcing anything.
    expect(transport.isConnected("host-1")).toBe(true);
    bridge.emit("data", "host-1", "events", JSON.stringify({ version: 2, type: "event-reset", nextSequence: 2_001 }));
    bridge.emit(
      "data",
      "host-1",
      "events",
      JSON.stringify({ version: 2, type: "event", sequence: 2_001, payload: null }),
    );
    expect(bridge.send).toHaveBeenCalledWith(
      "host-1",
      "events",
      JSON.stringify({
        version: 2,
        type: "event-control",
        control: { type: "runtime-snapshot-request" },
      }),
    );
    bridge.emit("disconnected", "host-1");
    expect(transport.isConnected("host-1")).toBe(false);
    const reconnection = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    await vi.waitFor(() => expect(authentication.pendingConfirmations).toHaveLength(1));
    authentication.confirmNext();
    await reconnection;

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(issueTicket).toHaveBeenNthCalledWith(2, "session-1", expect.stringContaining("PUBLIC KEY"));
    expect(issueTicket.mock.calls[0]?.[1]).toBe(issueTicket.mock.calls[0]?.[1].trim());
    expect(endSession).not.toHaveBeenCalled();
    expect(bridge.send).toHaveBeenLastCalledWith(
      "host-1",
      "events",
      JSON.stringify({ version: 2, type: "event-ack", throughSequence: 0 }),
    );
    const malformedRequest = Effect.runPromise(
      transport.request("host-1", "/v1/agents").pipe(Effect.mapError((error) => error.cause)),
    );
    const malformedRejection = expect(malformedRequest).rejects.toMatchObject({ code: "protocol_error" });
    await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith("host-1", "rpc", expect.any(String)));
    bridge.emit(
      "data",
      "host-1",
      "rpc",
      JSON.stringify({
        version: 2,
        type: "request",
        requestId: "host-request",
        operation: "GET /v1/agents",
        payload: null,
      }),
    );
    await malformedRejection;
    expect(protocolError).toHaveBeenCalledWith("host-1", "protocol_error", expect.any(String));
    await vi.waitFor(() => expect(bridge.disconnect).toHaveBeenCalledWith("host-1"));
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("stays connected on a session that expires further out than a timer can be set", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    const disconnectBridge = vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    mockAuthenticatedSend(bridge);
    // What the control plane answers `startSession` with for every account session: the largest date
    // JavaScript has. Scheduling the expiry for it directly overflows the timer range, and Node
    // resolves an overflow by firing in a millisecond -- so the session that never expires used to
    // be the one that hung up the moment it authenticated.
    const transport = createTransport(bridge, {
      startSession: () =>
        authCall(async () => ({ sessionId: "session-1", hostId: "host-1", expiresAt: 8_640_000_000_000_000 })),
    });
    await Effect.runPromise(transport.listHosts().pipe(Effect.mapError((error) => error.cause)));
    transport.pinHostKey("host-1", hostKeys.publicKey);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
      await vi.advanceTimersByTimeAsync(5);
      expect(disconnectBridge).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("cancels a connection before a delayed session start can restore it", async () => {
    const bridge = new TeamWebRtcBridge();
    const connectBridge = vi.spyOn(bridge, "connect").mockReturnValue(Effect.void);
    vi.spyOn(bridge, "send").mockReturnValue(Effect.void);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    let resolveSession!: (value: { sessionId: string; hostId: string; expiresAt: number }) => void;
    const startSession = vi.fn(() =>
      authCall(
        () =>
          new Promise<{ sessionId: string; hostId: string; expiresAt: number }>((resolve) => {
            resolveSession = resolve;
          }),
      ),
    );
    const endSession = vi.fn().mockReturnValue(Effect.succeed(undefined));
    const transport = new TeamWebRtcClientTransport({
      bridge,
      listHosts: () => authCall(async () => [listedHost]),
      startSession,
      issueTicket: () =>
        authCall(async () => ({
          ticket: "ticket",
          expiresAt: 2_000,
          signalUrl: "wss://signal.example.test/v1/signal",
        })),
      endSession,
      createInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          token: "token",
          expiresAt: 2_000,
          permanent: false,
          useCount: 0,
        })),
      listInvites: () => authCall(async () => []),
      previewInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          hostId: "host-1",
          hostName: "Host",
          role: "member",
          expiresAt: 2_000,
          emailBound: false,
          permanent: false,
          devicePublicKey: null,
        })),
      acceptInvite: () => authCall(async () => ({ hostId: "host-1", membershipId: "member-1", role: "member" })),
      revokeInvite: () => authCall(async () => undefined),
      listMembers: () => authCall(async () => []),
      updateMember: () => authCall(async () => undefined),
      removeMember: () => authCall(async () => undefined),
      getPrincipalId: () => "user-1",
      controlPlaneUrl: "https://api.example.test",
      downloadHostLogo: () => authCall(async () => ({ bytes: new Uint8Array(), mimeType: "image/png" })),
      transferDirectory: join(tmpdir(), "openbot-webrtc-client-cancel-test"),
    });
    transport.pinHostKey("host-1", hostKeys.publicKey);

    const connection = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    await Effect.runPromise(transport.disconnect("host-1").pipe(Effect.mapError((error) => error.cause)));
    resolveSession({ sessionId: "session-1", hostId: "host-1", expiresAt: Date.now() + 86_400_000 });

    await expect(connection).rejects.toThrow("cancelled");
    expect(connectBridge).not.toHaveBeenCalled();
    expect(endSession).toHaveBeenCalledWith("session-1");
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("does not reuse a remote session after the signed-in principal changes", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    mockAuthenticatedSend(bridge);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const startSession = vi
      .fn()
      .mockReturnValueOnce(
        Effect.succeed({ sessionId: "session-1", hostId: "host-1", expiresAt: Date.now() + 86_400_000 }),
      )
      .mockReturnValueOnce(
        Effect.succeed({ sessionId: "session-2", hostId: "host-1", expiresAt: Date.now() + 86_400_000 }),
      );
    const endSession = vi.fn().mockReturnValue(Effect.succeed(undefined));
    let principalId = "user-1";
    const transport = new TeamWebRtcClientTransport({
      bridge,
      listHosts: () => authCall(async () => [listedHost]),
      startSession,
      issueTicket: (sessionId) =>
        authCall(async () => ({
          ticket: sessionId,
          expiresAt: 2_000,
          signalUrl: "wss://signal.example.test/v1/signal",
        })),
      endSession,
      createInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          token: "token",
          expiresAt: 2_000,
          permanent: false,
          useCount: 0,
        })),
      listInvites: () => authCall(async () => []),
      previewInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          hostId: "host-1",
          hostName: "Host",
          role: "member",
          expiresAt: 2_000,
          emailBound: false,
          permanent: false,
          devicePublicKey: null,
        })),
      acceptInvite: () => authCall(async () => ({ hostId: "host-1", membershipId: "member-1", role: "member" })),
      revokeInvite: () => authCall(async () => undefined),
      listMembers: () => authCall(async () => []),
      updateMember: () => authCall(async () => undefined),
      removeMember: () => authCall(async () => undefined),
      getPrincipalId: () => principalId,
      controlPlaneUrl: "https://api.example.test",
      downloadHostLogo: () => authCall(async () => ({ bytes: new Uint8Array(), mimeType: "image/png" })),
      transferDirectory: join(tmpdir(), "openbot-webrtc-client-principal-test"),
    });
    transport.pinHostKey("host-1", hostKeys.publicKey);

    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    principalId = "user-2";
    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(endSession).toHaveBeenCalledWith("session-1");
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("replaces a logical session before it expires", async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    mockAuthenticatedSend(bridge);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const startSession = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed({ sessionId: "session-1", hostId: "host-1", expiresAt: now + 100_000 }))
      .mockReturnValueOnce(Effect.succeed({ sessionId: "session-2", hostId: "host-1", expiresAt: now + 200_000 }));
    const issueTicket = vi.fn((sessionId: string) =>
      Effect.succeed({
        ticket: sessionId,
        expiresAt: now + 60_000,
        signalUrl: "wss://signal.example.test/v1/signal",
      }),
    );
    const endSession = vi.fn().mockReturnValue(Effect.succeed(undefined));
    const transport = new TeamWebRtcClientTransport({
      bridge,
      listHosts: () => authCall(async () => [listedHost]),
      startSession,
      issueTicket,
      endSession,
      createInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          token: "token",
          expiresAt: now + 60_000,
          permanent: false,
          useCount: 0,
        })),
      listInvites: () => authCall(async () => []),
      previewInvite: () =>
        authCall(async () => ({
          inviteId: "invite",
          hostId: "host-1",
          hostName: "Host",
          role: "member",
          expiresAt: now + 60_000,
          emailBound: false,
          permanent: false,
          devicePublicKey: null,
        })),
      acceptInvite: () => authCall(async () => ({ hostId: "host-1", membershipId: "member-1", role: "member" })),
      revokeInvite: () => authCall(async () => undefined),
      listMembers: () => authCall(async () => []),
      updateMember: () => authCall(async () => undefined),
      removeMember: () => authCall(async () => undefined),
      getPrincipalId: () => "user-1",
      controlPlaneUrl: "https://api.example.test",
      downloadHostLogo: () => authCall(async () => ({ bytes: new Uint8Array(), mimeType: "image/png" })),
      transferDirectory: join(tmpdir(), "openbot-webrtc-client-expiration-test"),
    });
    transport.pinHostKey("host-1", hostKeys.publicKey);

    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    bridge.emit("disconnected", "host-1");
    nowSpy.mockReturnValue(now + 80_000);
    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(issueTicket).toHaveBeenNthCalledWith(2, "session-2", expect.stringContaining("PUBLIC KEY"));
    expect(endSession).toHaveBeenCalledWith("session-1");
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
    nowSpy.mockRestore();
  });

  // A response frame whose *body* the released V3 adapter refuses is the same failure as a frame
  // that is not a response at all: the host is talking a protocol this build cannot read. It has to
  // carry the same code, because an ordinary request error leaves the caller reconnecting to a host
  // that will answer the next request with the same nonsense.
  it("reports an undecodable response body as a protocol failure", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    const authentication = mockAuthenticatedSend(bridge);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const transport = createTransport(bridge);
    await Effect.runPromise(transport.listHosts().pipe(Effect.mapError((error) => error.cause)));
    transport.pinHostKey("host-1", hostKeys.publicKey);
    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));

    // `GET /v1/agents/:id/usage` is one of the routes carried by the V3 codec, so its body is the
    // adapter's to accept -- and a number where the shape says otherwise is not something it can.
    const pending = Effect.runPromise(
      transport.request("host-1", "/v1/agents/research/usage").pipe(Effect.mapError((error) => error.cause)),
    );
    const rejection = expect(pending).rejects.toMatchObject({ code: "protocol_error" });
    await vi.waitFor(() => expect(sentRequestId(authentication.send)).toBeTruthy());
    bridge.emit(
      "data",
      "host-1",
      "rpc",
      JSON.stringify({
        version: 2,
        type: "response",
        requestId: sentRequestId(authentication.send),
        result: { status: 200, body: { totals: 7 } },
      }),
    );

    await rejection;
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("carries channel payloads and revision events outside the released base adapter", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    const authentication = mockAuthenticatedSend(bridge);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const transport = createTransport(bridge);
    await Effect.runPromise(transport.listHosts().pipe(Effect.mapError((error) => error.cause)));
    transport.pinHostKey("host-1", hostKeys.publicKey);
    await Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    const pending = Effect.runPromise(
      transport.request("host-1", "/v1/channels").pipe(Effect.mapError((error) => error.cause)),
    );
    await vi.waitFor(() => expect(sentRequestId(authentication.send)).toBeTruthy());
    const channels = [
      {
        id: "channel-1",
        name: "Project",
        title: "",
        instructions: "Research",
        members: [],
        leadAgentId: null,
        archived: false,
        revision: 1,
        createdAt: "2026-09-07T12:00:00.000Z",
        unreadCount: 0,
        activeTasks: 0,
        lastMessage: null,
      },
    ];
    bridge.emit(
      "data",
      "host-1",
      "rpc",
      JSON.stringify({
        version: 2,
        type: "response",
        requestId: sentRequestId(authentication.send),
        result: { status: 200, body: channels },
      }),
    );
    expect(await pending).toEqual(channels);
    const event = vi.fn();
    transport.on("event", event);
    bridge.emit(
      "data",
      "host-1",
      "events",
      JSON.stringify({
        version: 2,
        type: "event",
        sequence: 1,
        payload: { type: "channels-changed", channelId: "channel-1", revision: 2 },
      }),
    );
    expect(event).toHaveBeenCalledWith("host-1", { type: "channels-changed", channelId: "channel-1", revision: 2 });
    for (const [sequence, payload] of [
      { type: "channel-memories-changed", channelId: "channel-1" },
      { type: "channel-routines-changed", channelId: "channel-1" },
      { type: "skills-changed", agentId: "agent-1" },
    ].entries()) {
      bridge.emit(
        "data",
        "host-1",
        "events",
        JSON.stringify({ version: 2, type: "event", sequence: sequence + 2, payload }),
      );
      expect(event).toHaveBeenCalledWith("host-1", payload);
    }
    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });

  it("rejects every concurrent caller when the bridge connection fails", async () => {
    const bridge = new TeamWebRtcBridge();
    let rejectBridge!: (error: Error) => void;
    const connectBridge = vi.spyOn(bridge, "connect").mockImplementation(() =>
      remoteCall(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectBridge = reject;
          }),
      ),
    );
    vi.spyOn(bridge, "send").mockReturnValue(Effect.void);
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    const startSession = vi.fn(() =>
      authCall(async () => ({
        sessionId: "session-1",
        hostId: "host-1",
        expiresAt: Date.now() + 86_400_000,
      })),
    );
    const issueTicket = vi.fn((sessionId: string) =>
      authCall(async () => ({
        ticket: sessionId,
        expiresAt: Date.now() + 180_000,
        signalUrl: "wss://signal.example.test/v1/signal",
      })),
    );
    const endSession = vi.fn().mockReturnValue(Effect.succeed(undefined));
    const transport = createTransport(bridge, { startSession, issueTicket, endSession });
    transport.pinHostKey("host-1", hostKeys.publicKey);

    const first = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledOnce());
    const second = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    rejectBridge(new Error("bridge failed"));
    const results = await Promise.allSettled([first, second]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "rejected" && result.reason.message === "bridge failed")).toBe(
      true,
    );
    // A failed attempt keeps its session, so a retry against an offline host costs one ticket.
    expect(endSession).not.toHaveBeenCalled();
    const retry = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledTimes(2));
    rejectBridge(new Error("bridge failed"));
    await expect(retry).rejects.toThrow("bridge failed");
    expect(startSession).toHaveBeenCalledOnce();
    expect(issueTicket).toHaveBeenNthCalledWith(2, "session-1", expect.stringContaining("PUBLIC KEY"));
    expect(endSession).not.toHaveBeenCalled();

    // A temporary account API failure keeps the session; only an ended session is replaced.
    const apiError = (status: number) => Object.assign(new Error(`status ${status}`), { status });
    issueTicket.mockReturnValueOnce(Effect.fail(new CentralAuthOperationError({ cause: apiError(503) })));
    await expect(
      Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("status 503");
    expect(startSession).toHaveBeenCalledOnce();
    expect(endSession).not.toHaveBeenCalled();
    issueTicket.mockReturnValueOnce(Effect.fail(new CentralAuthOperationError({ cause: apiError(403) })));
    const replaced = Effect.runPromise(transport.connect("host-1").pipe(Effect.mapError((error) => error.cause)));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledTimes(3));
    rejectBridge(new Error("bridge failed"));
    await expect(replaced).rejects.toThrow("bridge failed");
    expect(endSession).toHaveBeenCalledWith("session-1");
    expect(startSession).toHaveBeenCalledTimes(2);

    await Effect.runPromise(transport.stop().pipe(Effect.mapError((error) => error.cause)));
  });
});
