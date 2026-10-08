import { Effect } from "effect";
import { authCall, CentralAuthOperationError } from "./central-auth-effects";
import { remoteCall } from "./remote-service-effects";
// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteConnectTrace } from "./remote-connect-trace";
import { RemoteSessionCache } from "./remote-session-cache";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";
import type { TraceSpan } from "./trace-file";

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
  it("waits for the host directory only for a host without a pinned key, and still refuses one it does not pin", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "start").mockReturnValue(Effect.void);
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
      }),
    );
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    mockAuthenticatedSend(bridge);
    const startSession = vi.fn((hostId: string) =>
      authCall(async () => ({ sessionId: `session-${hostId}`, hostId, expiresAt: Date.now() + 86_400_000 })),
    );
    const transport = createTransport(bridge, { startSession });
    transport.pinHostKey("host-1", hostKeys.publicKey);
    try {
      transport.beginHostKeySync();
      await runCauseEffect(transport.connect("host-1"));
      const pinnedByDirectory = runCauseEffect(transport.connect("host-2"));
      const unpinned = runCauseEffect(transport.connect("host-3"));
      const refused = expect(unpinned).rejects.toThrow("pinned device key");
      expect(startSession.mock.calls.map(([hostId]) => hostId)).toEqual(["host-1"]);
      transport.pinHostKey("host-2", hostKeys.publicKey);
      transport.endHostKeySync();
      await pinnedByDirectory;
      await refused;
      expect(startSession.mock.calls.map(([hostId]) => hostId)).toEqual(["host-1", "host-2"]);
    } finally {
      await runCauseEffect(transport.stop());
    }
  });

  it("traces each connection phase without a host, session, ticket or key", async () => {
    const bridge = new TeamWebRtcBridge();
    vi.spyOn(bridge, "start").mockReturnValue(Effect.void);
    vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
      remoteCall(async () => {
        queueMicrotask(() => {
          bridge.emit("signalReady", peerId);
          bridge.emit("connected", peerId, channelBinding);
        });
      }),
    );
    vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
    mockAuthenticatedSend(bridge);
    const spans: TraceSpan[] = [];
    const transport = createTransport(bridge, { connectTrace: new RemoteConnectTrace((span) => spans.push(span)) });
    transport.pinHostKey("host-1", hostKeys.publicKey);
    try {
      await runCauseEffect(transport.connect("host-1"));
      await vi.waitFor(() => expect(spans.map((span) => span.name)).toContain("remote-connect:auth"));
      expect(spans.map((span) => span.name)).toEqual(
        expect.arrayContaining([
          "remote-connect:start",
          "remote-connect:session",
          "remote-connect:ticket",
          "remote-connect:bridge",
          "remote-connect:signal",
          "remote-connect:channels",
          "remote-connect:auth",
        ]),
      );
      const written = JSON.stringify(spans);
      for (const secret of ["host-1", "session-1", "signal.example.test", hostKeys.publicKey.slice(30, 60)]) {
        expect(written).not.toContain(secret);
      }
    } finally {
      await runCauseEffect(transport.stop());
    }
  });

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
      await runCauseEffect(transport.connect("host-1"));
      const pending = runCauseEffect(transport.request("host-1", "/v1/agents/research", { method: "DELETE" }));
      const failure = expect(pending).rejects.toMatchObject({ code: "remote_disconnected", status: 503 });
      await vi.waitFor(() => expect(sentRequestId(authentication.send)).not.toBeNull());
      const sentBeforeStop = authentication.send.mock.calls.length;
      await runCauseEffect(transport.stop());
      await failure;
      expect(authentication.send.mock.calls.length).toBe(sentBeforeStop);
    } finally {
      await runCauseEffect(transport.stop());
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
    await runCauseEffect(transport.listHosts());
    await expect(runCauseEffect(transport.connect("host-1"))).rejects.toThrow("pinned device key");
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

    const initialConnection = runCauseEffect(transport.connect("host-1"));
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
    const reconnection = runCauseEffect(transport.connect("host-1"));
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
    const malformedRequest = runCauseEffect(transport.request("host-1", "/v1/agents"));
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
    await runCauseEffect(transport.stop());
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
    await runCauseEffect(transport.listHosts());
    transport.pinHostKey("host-1", hostKeys.publicKey);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      await runCauseEffect(transport.connect("host-1"));
      await vi.advanceTimersByTimeAsync(5);
      expect(disconnectBridge).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    await runCauseEffect(transport.stop());
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

    const connection = runCauseEffect(transport.connect("host-1"));
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    await runCauseEffect(transport.disconnect("host-1"));
    resolveSession({ sessionId: "session-1", hostId: "host-1", expiresAt: Date.now() + 86_400_000 });

    await expect(connection).rejects.toThrow("cancelled");
    expect(connectBridge).not.toHaveBeenCalled();
    expect(endSession).toHaveBeenCalledWith("session-1");
    await runCauseEffect(transport.stop());
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

    await runCauseEffect(transport.connect("host-1"));
    principalId = "user-2";
    await runCauseEffect(transport.connect("host-1"));

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(endSession).toHaveBeenCalledWith("session-1");
    await runCauseEffect(transport.stop());
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

    await runCauseEffect(transport.connect("host-1"));
    bridge.emit("disconnected", "host-1");
    nowSpy.mockReturnValue(now + 80_000);
    await runCauseEffect(transport.connect("host-1"));

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(issueTicket).toHaveBeenNthCalledWith(2, "session-2", expect.stringContaining("PUBLIC KEY"));
    expect(endSession).toHaveBeenCalledWith("session-1");
    await runCauseEffect(transport.stop());
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
    await runCauseEffect(transport.listHosts());
    transport.pinHostKey("host-1", hostKeys.publicKey);
    await runCauseEffect(transport.connect("host-1"));

    // `GET /v1/agents/:id/usage` is one of the routes carried by the V3 codec, so its body is the
    // adapter's to accept -- and a number where the shape says otherwise is not something it can.
    const pending = runCauseEffect(transport.request("host-1", "/v1/agents/research/usage"));
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
    await runCauseEffect(transport.stop());
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
    await runCauseEffect(transport.listHosts());
    transport.pinHostKey("host-1", hostKeys.publicKey);
    await runCauseEffect(transport.connect("host-1"));
    const pending = runCauseEffect(transport.request("host-1", "/v1/channels"));
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
    await runCauseEffect(transport.stop());
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

    const first = runCauseEffect(transport.connect("host-1"));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledOnce());
    const second = runCauseEffect(transport.connect("host-1"));
    rejectBridge(new Error("bridge failed"));
    const results = await Promise.allSettled([first, second]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "rejected" && result.reason.message === "bridge failed")).toBe(
      true,
    );
    // A failed attempt keeps its session, so a retry against an offline host costs one ticket.
    expect(endSession).not.toHaveBeenCalled();
    const retry = runCauseEffect(transport.connect("host-1"));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledTimes(2));
    rejectBridge(new Error("bridge failed"));
    await expect(retry).rejects.toThrow("bridge failed");
    expect(startSession).toHaveBeenCalledOnce();
    expect(issueTicket).toHaveBeenNthCalledWith(2, "session-1", expect.stringContaining("PUBLIC KEY"));
    expect(endSession).not.toHaveBeenCalled();

    // A temporary account API failure keeps the session; only an ended session is replaced.
    const apiError = (status: number) => Object.assign(new Error(`status ${status}`), { status });
    issueTicket.mockReturnValueOnce(Effect.fail(new CentralAuthOperationError({ cause: apiError(503) })));
    await expect(runCauseEffect(transport.connect("host-1"))).rejects.toThrow("status 503");
    expect(startSession).toHaveBeenCalledOnce();
    expect(endSession).not.toHaveBeenCalled();
    issueTicket.mockReturnValueOnce(Effect.fail(new CentralAuthOperationError({ cause: apiError(403) })));
    const replaced = runCauseEffect(transport.connect("host-1"));
    await vi.waitFor(() => expect(connectBridge).toHaveBeenCalledTimes(3));
    rejectBridge(new Error("bridge failed"));
    await expect(replaced).rejects.toThrow("bridge failed");
    expect(endSession).toHaveBeenCalledWith("session-1");
    expect(startSession).toHaveBeenCalledTimes(2);

    await runCauseEffect(transport.stop());
  });

  describe("sessions kept between runs", () => {
    const signalUrl = "wss://signal.example.test/v1/signal";
    const storedSession = { sessionId: "session-stored", expiresAt: Date.now() + 86_400_000 };

    async function sessionCache(canPersist = true) {
      const directory = await mkdtemp(join(tmpdir(), "openbot-remote-sessions-"));
      const create = () =>
        new RemoteSessionCache({
          path: join(directory, "sessions.bin"),
          canPersist: () => canPersist,
          encrypt: (value) => Buffer.from(value),
          decrypt: (value) => value.toString(),
        });
      return { create, remove: () => rm(directory, { recursive: true, force: true }) };
    }

    function connectingBridge() {
      const bridge = new TeamWebRtcBridge();
      vi.spyOn(bridge, "start").mockReturnValue(Effect.void);
      const prepareSignal = vi.spyOn(bridge, "prepareSignal").mockReturnValue(Effect.void);
      const connect = vi.spyOn(bridge, "connect").mockImplementation(({ peerId }) =>
        remoteCall(async () => {
          queueMicrotask(() => bridge.emit("connected", peerId, channelBinding));
        }),
      );
      vi.spyOn(bridge, "disconnect").mockReturnValue(Effect.void);
      mockAuthenticatedSend(bridge);
      return { bridge, prepareSignal, connect };
    }

    function sessionCalls() {
      return {
        startSession: vi.fn((hostId: string) =>
          authCall(async () => ({ sessionId: "session-new", hostId, expiresAt: Date.now() + 86_400_000 })),
        ),
        issueTicket: vi.fn((sessionId: string) =>
          authCall(async () => ({ ticket: sessionId, expiresAt: Date.now() + 180_000, signalUrl })),
        ),
        endSession: vi.fn((_sessionId: string) => Effect.succeed(undefined)),
      };
    }

    it("asks only for a ticket for the session of the last run, and opens Signal while it waits", async () => {
      const files = await sessionCache();
      const seeded = files.create();
      await Effect.runPromise(seeded.set("user-1", "host-1", storedSession, signalUrl));
      const { bridge, prepareSignal, connect } = connectingBridge();
      const calls = sessionCalls();
      const spans: TraceSpan[] = [];
      const transport = createTransport(bridge, {
        ...calls,
        sessionCache: files.create(),
        connectTrace: new RemoteConnectTrace((span) => spans.push(span)),
      });
      transport.pinHostKey("host-1", hostKeys.publicKey);
      try {
        await runCauseEffect(transport.connect("host-1"));
        expect(calls.startSession).not.toHaveBeenCalled();
        expect(calls.issueTicket).toHaveBeenCalledWith("session-stored", expect.stringContaining("PUBLIC KEY"));
        expect(prepareSignal).toHaveBeenCalledWith("host-1", signalUrl);
        expect(prepareSignal.mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[0] ?? 0);
        expect(spans.find((span) => span.name === "remote-connect:session")?.outcome).toBe("stored");
      } finally {
        await runCauseEffect(transport.stop());
        await files.remove();
      }
    });

    it("starts and keeps a new session when the account service refused the stored one", async () => {
      const files = await sessionCache();
      await Effect.runPromise(files.create().set("user-1", "host-1", storedSession, signalUrl));
      const { bridge } = connectingBridge();
      const calls = sessionCalls();
      const ended = Object.assign(new Error("The remote session is not active."), { status: 403 });
      calls.issueTicket.mockReturnValueOnce(Effect.fail(new CentralAuthOperationError({ cause: ended })));
      const transport = createTransport(bridge, { ...calls, sessionCache: files.create() });
      transport.pinHostKey("host-1", hostKeys.publicKey);
      try {
        await runCauseEffect(transport.connect("host-1"));
        expect(calls.endSession).toHaveBeenCalledWith("session-stored");
        expect(calls.startSession).toHaveBeenCalledOnce();
        expect(calls.issueTicket).toHaveBeenLastCalledWith("session-new", expect.any(String));
        const next = files.create();
        await Effect.runPromise(next.load());
        expect(next.get("user-1", "host-1")?.sessionId).toBe("session-new");
      } finally {
        await runCauseEffect(transport.stop());
        await files.remove();
      }
    });

    it("does not use a session of another account", async () => {
      const files = await sessionCache();
      await Effect.runPromise(files.create().set("user-2", "host-1", storedSession, signalUrl));
      const { bridge, prepareSignal } = connectingBridge();
      const calls = sessionCalls();
      const transport = createTransport(bridge, { ...calls, sessionCache: files.create() });
      transport.pinHostKey("host-1", hostKeys.publicKey);
      try {
        await runCauseEffect(transport.connect("host-1"));
        expect(calls.startSession).toHaveBeenCalledOnce();
        expect(calls.issueTicket).toHaveBeenCalledWith("session-new", expect.any(String));
        expect(prepareSignal).not.toHaveBeenCalled();
      } finally {
        await runCauseEffect(transport.stop());
        await files.remove();
      }
    });

    it("keeps the session open at quit, and ends and forgets it on disconnect or sign-out", async () => {
      const files = await sessionCache();
      const first = connectingBridge();
      const calls = sessionCalls();
      const quitting = createTransport(first.bridge, { ...calls, sessionCache: files.create() });
      quitting.pinHostKey("host-1", hostKeys.publicKey);
      try {
        await runCauseEffect(quitting.connect("host-1"));
        await runCauseEffect(quitting.stop());
        expect(calls.endSession).not.toHaveBeenCalled();

        const second = connectingBridge();
        const cache = files.create();
        const next = createTransport(second.bridge, { ...calls, sessionCache: cache });
        next.pinHostKey("host-1", hostKeys.publicKey);
        await runCauseEffect(next.connect("host-1"));
        expect(calls.startSession).toHaveBeenCalledOnce();
        await runCauseEffect(next.disconnect("host-1"));
        expect(calls.endSession).toHaveBeenCalledWith("session-new");
        expect(cache.get("user-1", "host-1")).toBeNull();
        const reread = files.create();
        await Effect.runPromise(reread.load());
        expect(reread.get("user-1", "host-1")).toBeNull();

        await runCauseEffect(next.connect("host-1"));
        await runCauseEffect(next.forgetStoredSessions());
        const signedOut = files.create();
        await Effect.runPromise(signedOut.load());
        expect(signedOut.get("user-1", "host-1")).toBeNull();
        await runCauseEffect(next.stop());
      } finally {
        await files.remove();
      }
    });

    it("ends the session at quit when the next run cannot read it", async () => {
      const files = await sessionCache(false);
      const { bridge } = connectingBridge();
      const calls = sessionCalls();
      const transport = createTransport(bridge, { ...calls, sessionCache: files.create() });
      transport.pinHostKey("host-1", hostKeys.publicKey);
      try {
        await runCauseEffect(transport.connect("host-1"));
        await runCauseEffect(transport.stop());
        expect(calls.endSession).toHaveBeenCalledWith("session-new");
      } finally {
        await files.remove();
      }
    });
  });
});
