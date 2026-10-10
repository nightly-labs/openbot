import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
  TEAM_PROTOCOL_V2_CHANNELS,
  type TeamProtocolV2Json,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEd25519Identity, signEd25519 } from "./ed25519";
import { runTeamEffect } from "./effect-boundary";
import {
  createRemoteCommandMailbox,
  createRemoteTeamPeer,
  type RemoteTeamCommand,
  type RemoteTeamConnectionUpdate,
  type RemoteUploadProgress,
} from "./remote-peer";
import { createRemoteConnectionRecovery } from "./remote-recovery";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "./webrtc-framing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const channelFixture = {
  id: "channel-one",
  name: "Launch room",
  title: "",
  instructions: "Prepare a release",
  members: [{ agentId: "agent-one" }],
  leadAgentId: "agent-one",
  archived: false,
  revision: 2,
  createdAt: "2026-09-14T00:00:00Z",
};

describe("browser remote peer recovery", () => {
  it("sends ICE candidates without sending gathering completion markers", async () => {
    const network = await setupNetwork();
    await network.connect();
    const send = vi.spyOn(network.socket(), "send");
    const candidate = {
      candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    network.connection().onicecandidate?.({ candidate });
    network.connection().onicecandidate?.({ candidate: { ...candidate, candidate: "" } });
    network.connection().onicecandidate?.({ candidate: null });
    expect(send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      { type: "ice-candidate", version: 1, connectionId: "connection-1", channel: "team", ...candidate },
    ]);
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await network.runtime.dispose();
  });
  it("delivers browser-view frames only while the host connection is authenticated", async () => {
    const received = deferred();
    const onHostStreamData = vi.fn(() => {
      received.resolve();
    });
    const network = await setupNetwork({ onHostStreamData });
    await expect(network.runtime.sendHostStreamData("frame")).rejects.toThrow("offline");
    await network.connect();
    const channel = network.connection().channel("openbot.remote-desktop.signal.v1");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    for (const frame of encodeTeamWebRtcPayload(bytes, 64 * 1024)) channel.receive(frame);
    await received.promise;
    expect(onHostStreamData).toHaveBeenCalledWith(bytes);
    await network.runtime.dispose();
    for (const frame of encodeTeamWebRtcPayload(bytes, 64 * 1024)) channel.receive(frame);
    expect(onHostStreamData).toHaveBeenCalledOnce();
    await expect(network.runtime.sendHostStreamData("frame")).rejects.toThrow("offline");
  });
  it.each<{ path: string; method: string; body: TeamProtocolV2Json; response: TeamProtocolV2Json }>([
    {
      path: CHANNEL_ROUTES.list,
      method: "GET",
      body: {},
      response: [{ ...channelFixture, unreadCount: 1, activeTasks: 0, lastMessage: null }],
    },
    {
      path: CHANNEL_ROUTES.read,
      method: "POST",
      body: { channelId: "channel-one" },
      response: { channel: channelFixture, messages: [], tasks: [], olderCursor: null, throughSequence: 0 },
    },
    {
      path: CHANNEL_ROUTES.command,
      method: "POST",
      body: {
        type: "save",
        operationId: "save-one",
        channelId: "channel-one",
        draft: {
          name: "Launch room",
          title: "",
          instructions: "Prepare a release",
          members: [{ agentId: "agent-one" }],
          leadAgentId: "agent-one",
        },
        update: true,
      },
      response: channelFixture,
    },
    { path: CHANNEL_ROUTES.memories, method: "POST", body: { channelId: "channel-one" }, response: [] },
  ])("uses the optional channel codec for $path without disconnecting", async ({ path, method, body, response }) => {
    const network = await setupNetwork({ responseBody: response });
    await network.connect();
    const result = await network.runtime.execute({ id: "channel-request", type: "request", method, path, body });
    expect(result).toMatchObject({ ok: true, status: 200, body: response });
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await network.runtime.dispose();
  });
  it.each<{ path: string; body: TeamProtocolV2Json; response: TeamProtocolV2Json }>([
    {
      path: STORAGE_ROUTES.usage,
      body: { scope: "agent", agentId: "agent-one" },
      response: {
        scope: "agent",
        agentId: "agent-one",
        conversationId: null,
        scannedAt: "2026-09-14T00:00:00Z",
        freeBytes: null,
        breakdown: [{ category: "attachments", bytes: 12, removable: false }],
        agents: [],
        conversations: [],
        files: [],
        truncated: false,
      },
    },
    { path: STORAGE_ROUTES.deleteFile, body: { fileId: "file-one" }, response: {} },
  ])("uses the optional storage codec for $path without disconnecting", async ({ path, body, response }) => {
    const network = await setupNetwork({ responseBody: response });
    await network.connect();
    const result = await network.runtime.execute({
      id: "storage-request",
      type: "request",
      method: "POST",
      path,
      body,
    });
    expect(result).toMatchObject({ ok: true, status: 200, body: response });
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await network.runtime.dispose();
  });
  it("still rejects a malformed channel response and closes the peer", async () => {
    const network = await setupNetwork({ responseBody: [{ id: "channel-one" }] });
    await network.connect();
    const result = await network.runtime.execute({
      id: "bad-channel-response",
      type: "request",
      method: "GET",
      path: CHANNEL_ROUTES.list,
      body: {},
    });
    expect(result).toMatchObject({ ok: false });
    expect(network.updates.at(-1)).toMatchObject({ state: "offline" });
    await network.runtime.dispose();
  });

  it("delivers channel changes through the authenticated event stream", async () => {
    const received = deferred();
    const onTeamEvent = vi.fn(async () => {
      received.resolve();
    });
    const network = await setupNetwork({ onTeamEvent });
    await network.connect();
    const event = { type: "channels-changed", channelId: "channel-one", revision: 2 };
    network
      .connection()
      .channel(TEAM_PROTOCOL_V2_CHANNELS.events)
      .receive(encodeTeamProtocolV2Frame({ version: 2, type: "event", sequence: 1, payload: event }));
    await received.promise;
    expect(onTeamEvent).toHaveBeenCalledWith("host", event);
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await network.runtime.dispose();
  });
  it("translates optional quiet completion and still accepts a released completion", async () => {
    const onTeamEvent = vi.fn(async () => {});
    const network = await setupNetwork({ onTeamEvent });
    await network.connect();
    const event = {
      type: "quiet-turn-completed",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      origin: "routine",
    };
    const channel = network.connection().channel(TEAM_PROTOCOL_V2_CHANNELS.events);
    channel.receive(encodeTeamProtocolV2Frame({ version: 2, type: "event", sequence: 1, payload: event }));
    await vi.waitFor(() =>
      expect(onTeamEvent).toHaveBeenCalledWith("host", {
        ...event,
        type: "turn-completed",
        quiet: true,
      }),
    );
    const { agentId, ...wire } = event;
    channel.receive(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "event",
        sequence: 2,
        payload: { ...wire, type: "turn-completed", botId: agentId },
      }),
    );
    await vi.waitFor(() => expect(onTeamEvent).toHaveBeenCalledWith("host", { ...event, type: "turn-completed" }));
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await network.runtime.dispose();
  });

  it("ignores an unknown event and rejects a malformed quiet completion", async () => {
    const onTeamEvent = vi.fn(async () => {});
    const network = await setupNetwork({ onTeamEvent });
    await network.connect();
    const channel = network.connection().channel(TEAM_PROTOCOL_V2_CHANNELS.events);
    channel.receive(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "event",
        sequence: 1,
        payload: { type: "future-optional-event" },
      }),
    );
    channel.receive(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "event",
        sequence: 2,
        payload: { type: "quiet-turn-completed", agentId: "agent-1" },
      }),
    );
    await vi.waitFor(() => expect(network.updates.at(-1)).toMatchObject({ state: "offline" }));
    expect(onTeamEvent).not.toHaveBeenCalled();
    await network.runtime.dispose();
  });

  it("rejects an invalid outgoing request without leaving a promise to fail on disconnect", async () => {
    const network = await setupNetwork();
    await network.connect();
    const result = await network.runtime.execute({
      id: "invalid-request",
      type: "request",
      method: "GET",
      path: "/unsupported",
      body: {},
    });
    expect(result).toMatchObject({ ok: false });
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    // Vitest reports an unhandled rejection here if validation registered an abandoned request.
    await network.runtime.dispose();
  });

  it("checks healthy foreground returns silently without requesting new session tickets", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let requested = deferred();
    let response = Promise.resolve();
    const network = await setupNetwork({
      responseBody: { appVersion: "test", protocol: { minimum: 3, maximum: 3 }, capabilities: [] },
      beforeResponse: () => {
        requested.resolve();
        return response;
      },
    });
    let online = deferred();
    const phases: string[] = [];
    const recovery = createRemoteConnectionRecovery(
      async () => {
        const connected = await network.connect();
        if (!connected.ok) throw new Error(connected.error);
        const checked = await network.runtime.execute({
          id: "foreground-read",
          type: "request",
          method: "GET",
          path: "/v1/compatibility",
          body: {},
        });
        if (!checked.ok) throw new Error(checked.error);
      },
      () => {},
      (status) => {
        phases.push(status.phase);
        if (status.phase === "online") online.resolve();
      },
    );
    try {
      recovery.setActive(true);
      await online.promise;
      for (const minutes of [0, 5, 10, 15, 60]) {
        recovery.setActive(false);
        network.runtime.setActive(false);
        await vi.advanceTimersByTimeAsync(minutes * 60_000);
        phases.length = 0;
        requested = deferred();
        online = deferred();
        const pending = deferred();
        response = pending.promise;
        network.runtime.setActive(true);
        recovery.setActive(true);
        await requested.promise;
        // A pending health read must not disable the workspace or show Reconnecting.
        expect(phases).toEqual([]);
        expect(network.bootstraps()).toBe(1);
        pending.resolve();
        await online.promise;
        expect(phases).toEqual(["online"]);
      }
    } finally {
      recovery.dispose();
      await network.runtime.dispose();
    }
  });

  it("uploads photo bytes when the mobile runtime has no crypto.randomUUID", async () => {
    const random = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: random, subtle: crypto.subtle });
    const summary = {
      id: "uploaded-photo",
      name: "photo.png",
      kind: "image",
      mimeType: "image/png",
      size: 5,
      previewKind: "none",
      previewUrl: null,
    };
    const network = await setupNetwork({ responseBody: summary });
    await network.connect();
    const channel = network.connection().channel(TEAM_PROTOCOL_V2_CHANNELS.files);
    const decoder = new TeamWebRtcPayloadDecoder();
    const chunks: number[] = [];
    vi.spyOn(channel, "send").mockImplementation((data: string | ArrayBuffer) => {
      const payload = decoder.push(data);
      if (payload === undefined) return;
      if (typeof payload !== "string") {
        chunks.push(...decodeTeamProtocolV2FileChunk(payload).bytes);
        // Queued is not sent: the chunk still waits in the channel's buffer.
        channel.bufferedAmount = payload.byteLength;
        return;
      }
      const frame = decodeTeamProtocolV2FileControlFrame(payload);
      if (frame.type === "file-open")
        channel.receive(
          encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId: frame.transferId, receivedThrough: 0 }),
        );
    });
    try {
      const result = await network.runtime.execute({
        id: "upload",
        type: "request",
        method: "POST",
        path: "/v1/attachments?name=photo.png",
        body: null,
        upload: { name: "photo.png", mimeType: "image/png", base64: btoa("hello") },
      });
      expect({ result, bytes: chunks, progress: network.uploadProgress }).toEqual({
        result: { commandId: "upload", ok: true, status: 200, body: summary },
        bytes: [...new TextEncoder().encode("hello")],
        // Nothing counts as sent while it waits in the buffer; the host's answer completes it.
        progress: [
          { commandId: "upload", sent: 0, total: 5 },
          { commandId: "upload", sent: 5, total: 5 },
        ],
      });
    } finally {
      await network.runtime.dispose();
    }
  });

  it("keeps the connection online when an attachment download expires", async () => {
    const network = await setupNetwork({ responseFile: { transferId: "b6396068-3405-4e51-9b42-d97bfd1e2f33" } });
    await network.connect();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const result = network.runtime.execute({
        id: "expired-download",
        type: "request",
        method: "GET",
        path: "/v1/attachments/file-1",
        body: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toMatchObject({ ok: false, error: "The attachment download timed out. Try again." });
      expect(network.updates.at(-1)?.state).toBe("online");
    } finally {
      await network.runtime.dispose();
    }
  });

  it("returns authenticated attachment bytes through the native command bridge", async () => {
    const transferId = "b6396068-3405-4e51-9b42-d97bfd1e2f33";
    const network = await setupNetwork({
      responseFile: { transferId, name: "hello.txt", mimeType: "text/plain", size: 5 },
      beforeResponse: async () => {
        const channel = network.connection().channel(TEAM_PROTOCOL_V2_CHANNELS.files);
        channel.receive(
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-open",
            transferId,
            name: "hello.txt",
            mimeType: "text/plain",
            size: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          }),
        );
        for (const frame of encodeTeamWebRtcPayload(
          new Uint8Array(
            encodeTeamProtocolV2FileChunk({ transferId, offset: 0, bytes: new TextEncoder().encode("hello") }),
          ).buffer,
          65536,
        ))
          channel.receive(frame);
        channel.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }));
      },
    });
    await network.connect();
    try {
      expect(
        await network.runtime.execute({
          id: "download",
          type: "request",
          method: "GET",
          path: "/v1/attachments/file-1",
          body: null,
        }),
      ).toEqual({
        commandId: "download",
        ok: true,
        status: 200,
        body: { name: "hello.txt", mimeType: "text/plain", base64: btoa("hello") },
      });
    } finally {
      await network.runtime.dispose();
    }
  });

  it("reports session revocation so the client can refresh memberships immediately", async () => {
    const network = await setupNetwork();
    await network.connect();
    network
      .socket()
      .receive({ type: "error", version: 1, code: "session_revoked", message: "The remote session ended." });
    await vi.waitFor(() => expect(network.updates.at(-1)).toMatchObject({ state: "offline", code: "session_revoked" }));
    await network.runtime.dispose();
  });

  it("refreshes the account on Signal invalidation without breaking the team connection if refresh fails", async () => {
    const refreshProfile = vi.fn(async () => {
      throw new Error("Account API offline");
    });
    const network = await setupNetwork({ onAccountProfileChanged: refreshProfile });
    await network.connect();
    try {
      network.socket().receive({ type: "account-profile-changed", version: 1 });
      await vi.waitFor(() => expect(refreshProfile).toHaveBeenCalledTimes(1));
      const result = await network.runtime.execute({
        id: "after-profile",
        type: "request",
        method: "GET",
        path: "/v1/agents",
        body: {},
      });
      expect(result).toMatchObject({ ok: true, status: 200, body: [] });
    } finally {
      await network.runtime.dispose();
    }
  });

  it("re-reads the server list when Signal says the account joined one on another device", async () => {
    const refreshServers = vi.fn(async () => {
      throw new Error("Account API offline");
    });
    const network = await setupNetwork({ onAccountServersChanged: refreshServers });
    await network.connect();
    try {
      network.socket().receive({ type: "account-servers-changed", version: 1 });
      await vi.waitFor(() => expect(refreshServers).toHaveBeenCalledTimes(1));
      const result = await network.runtime.execute({
        id: "after-servers",
        type: "request",
        method: "GET",
        path: "/v1/agents",
        body: {},
      });
      expect(result).toMatchObject({ ok: true, status: 200, body: [] });
    } finally {
      await network.runtime.dispose();
    }
  });

  it("sends without delay when the data channel drains before the low-buffer listener is registered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const network = await setupNetwork();
    await network.connect();
    try {
      const channel = network.connection().channel(TEAM_PROTOCOL_V2_CHANNELS.rpc);
      channel.bufferedAmount = 8 * 1024 * 1024;
      const register = channel.addEventListener.bind(channel);
      vi.spyOn(channel, "addEventListener").mockImplementation((type, listener, options) => {
        if (type === "bufferedamountlow") {
          channel.bufferedAmount = 0;
          channel.dispatchEvent(new Event("bufferedamountlow"));
        }
        register(type, listener, options);
      });
      let result: { ok: boolean } | undefined;
      const reading = network.runtime
        .execute({
          id: "drained-buffer",
          type: "request",
          method: "GET",
          path: "/v1/agents",
          body: {},
        })
        .then((value) => {
          result = value;
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toMatchObject({ ok: true, status: 200, body: [] });
      await reading;
    } finally {
      await network.runtime.dispose();
    }
  });

  it("discards a silent peer after the required compatibility read times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const response = deferred();
    let requested = deferred();
    let silent = true;
    const network = await setupNetwork({
      beforeResponse: async () => {
        if (!silent) return;
        requested.resolve();
        await response.promise;
      },
    });
    const compatibility = (id: string) =>
      network.runtime.execute({ id, type: "request", method: "GET", path: "/v1/compatibility", body: {} });
    await network.connect();
    // The first read on a new peer can wait for a slow relay path, such as TURN over TLS.
    const first = compatibility("first-check");
    await requested.promise;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(network.updates.at(-1)).toMatchObject({ state: "online" });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(network.updates.at(-1)).toMatchObject({ state: "offline" });
    await expect(first).resolves.toMatchObject({ ok: false, error: "The desktop request timed out." });
    silent = false;
    await expect(network.connect()).resolves.toMatchObject({ ok: true });
    await expect(
      network.runtime.execute({ id: "answered", type: "request", method: "GET", path: "/v1/agents", body: {} }),
    ).resolves.toMatchObject({ ok: true });
    silent = true;
    requested = deferred();
    const resumed = compatibility("resume-check");
    await requested.promise;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(network.updates.at(-1)).toMatchObject({ state: "offline" });
    await expect(resumed).resolves.toMatchObject({ ok: false, error: "The desktop request timed out." });
    await expect(network.connect()).resolves.toMatchObject({ ok: true });
    expect(network.bootstraps()).toBe(3);
    response.resolve();
    await network.runtime.dispose();
  });

  it("rejects a malformed bootstrap response instead of leaving the agent loader pending forever", async () => {
    const network = await setupNetwork();
    await network.connect();
    const offline = deferred();
    network.onOffline = () => offline.resolve();
    let result: { ok: boolean } | undefined;
    // This fake host returns an array, which is not a compatibility document.
    const reading = network.runtime
      .execute({ id: "compatibility", type: "request", method: "GET", path: "/v1/compatibility", body: {} })
      .then((value) => {
        result = value;
      });
    await offline.promise;
    await vi.waitFor(() => expect(result).toMatchObject({ ok: false }));
    await reading;
    await network.runtime.dispose();
  });

  it.each(["initial-connect", "reconnect", "disconnect"] as const)(
    "waits for same-host session revocation before %s can bootstrap again",
    async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const cleanup = deferred();
      const initialOffer = deferred();
      const initialAnswer = deferred();
      let offered = false;
      let closingSession = false;
      const network = await setupNetwork({
        beforeAnswer: async () => {
          if (mode !== "initial-connect" || offered) return;
          offered = true;
          initialOffer.resolve();
          await initialAnswer.promise;
        },
        endSession: async () => {
          closingSession = true;
          await cleanup.promise;
          closingSession = false;
        },
        beforeBootstrap: async () => {
          // The directory reuses an active logical session. Bootstrapping during
          // its revocation would return a ticket for the session being ended.
          if (closingSession) throw new Error("The remote session ended.");
        },
      });
      const initial = network.connect();
      if (mode === "initial-connect") {
        await initialOffer.promise;
        network.connection().drop("failed");
        await expect(initial).resolves.toMatchObject({ ok: false });
        initialAnswer.resolve();
      } else await initial;
      const closed =
        mode === "disconnect" ? network.runtime.execute({ id: "disconnect", type: "disconnect" }) : Promise.resolve();
      // An authenticated peer on a failed path can still restart ICE; a closed one cannot.
      if (mode === "reconnect") network.connection().drop("closed");
      const reconnecting = network.connect();
      await vi.advanceTimersByTimeAsync(0);
      cleanup.resolve();
      await closed;
      await expect(reconnecting).resolves.toMatchObject({ ok: true });
      await expect(
        network.runtime.execute({ id: "agents", type: "request", method: "GET", path: "/v1/agents", body: {} }),
      ).resolves.toMatchObject({ ok: true, status: 200, body: [] });
      await network.runtime.dispose();
    },
  );

  it("switches servers while an RPC and remote session cleanup are still pending", async () => {
    const cleanup = deferred();
    const network = await setupNetwork({ endSession: () => cleanup.promise });
    await network.connect();
    const oldConnection = network.connection();
    const pending = network.runtime.execute({
      id: "slow",
      type: "request",
      method: "GET",
      path: "/v1/agents/slow/conversation",
      body: {},
    });
    await network.slowRequest.promise;
    await expect(network.connect("other-host")).resolves.toMatchObject({ ok: true });
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(oldConnection.connectionState).toBe("closed");
    expect(network.updates.at(-1)).toMatchObject({ hostId: "other-host", state: "online" });
    cleanup.resolve();
    await network.runtime.dispose();
  });

  it("does not report an old canceled connection as offline after its replacement is online", async () => {
    const bootstrap = deferred();
    const started = deferred();
    const network = await setupNetwork({
      beforeBootstrap: async (hostId) => {
        if (hostId === "host") {
          started.resolve();
          await bootstrap.promise;
        }
      },
    });
    const old = network.connect();
    await started.promise;
    await expect(network.connect("other-host")).resolves.toMatchObject({ ok: true });
    bootstrap.resolve();
    await expect(old).resolves.toMatchObject({ ok: false });
    expect(network.updates.at(-1)).toMatchObject({ hostId: "other-host", state: "online" });
    await network.runtime.dispose();
  });
  it("does not create a session when unmounted before a queued connection starts", async () => {
    const network = await setupNetwork();
    const connecting = network.connect();
    await network.runtime.dispose();
    await expect(connecting).resolves.toMatchObject({ ok: false });
    expect(network.bootstraps()).toBe(0);
  });

  it.each(["disconnected", "failed", "closed"] as const)(
    "releases a %s peer and authenticates a fresh connection",
    async (state) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const network = await setupNetwork();
      await expect(network.connect()).resolves.toMatchObject({ ok: true });
      network.connection().drop(state);
      if (state !== "closed") await vi.advanceTimersByTimeAsync(15_000);
      expect(network.updates.at(-1)?.state).toBe("offline");
      await expect(network.connect()).resolves.toMatchObject({ ok: true });
      expect(network.connections).toHaveLength(2);
      expect(network.bootstraps()).toBe(2);
      await expect(
        network.runtime.execute({ id: "read", type: "request", method: "GET", path: "/v1/agents", body: {} }),
      ).resolves.toMatchObject({ ok: true, status: 200, body: [] });
      await network.runtime.dispose();
    },
  );

  it("keeps the authenticated session when a short network interruption recovers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const network = await setupNetwork();
    await network.connect();
    network.connection().drop("disconnected");
    await vi.advanceTimersByTimeAsync(2_000);
    network.connection().drop("connected");
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await network.runtime.execute({
      id: "after-network-change",
      type: "request",
      method: "GET",
      path: "/v1/agents",
      body: {},
    });
    expect({ result, bootstraps: network.bootstraps(), state: network.updates.at(-1)?.state }).toEqual({
      result: { commandId: "after-network-change", ok: true, status: 200, body: [] },
      bootstraps: 1,
      state: "online",
    });
    await network.runtime.dispose();
  });

  it("restarts ICE on a failed path and renews a half-open Signal socket without a new session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const network = await setupNetwork();
    await network.connect();
    network.socket().halfOpen = true;
    network.connection().drop("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect({ restarts: network.connection().iceRestarts, sockets: network.sockets.length }).toEqual({
      restarts: 1,
      sockets: 1,
    });
    await vi.advanceTimersByTimeAsync(8_000);
    // The new socket's `ready` restarts ICE again, and this time the answer arrives.
    expect({ restarts: network.connection().iceRestarts, sockets: network.sockets.length }).toEqual({
      restarts: 2,
      sockets: 2,
    });
    network.connection().drop("connected");
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await network.runtime.execute({
      id: "after-ice-restart",
      type: "request",
      method: "GET",
      path: "/v1/agents",
      body: {},
    });
    expect({ result, bootstraps: network.bootstraps(), connections: network.connections.length }).toEqual({
      result: { commandId: "after-ice-restart", ok: true, status: 200, body: [] },
      bootstraps: 1,
      connections: 1,
    });
    expect(network.updates.some((update) => update.state === "offline")).toBe(false);
    await network.runtime.dispose();
  });

  it("renews Signal and tells the consumer when the network comes back", async () => {
    const onNetworkRestored = vi.fn(async () => {});
    const network = await setupNetwork({ onNetworkRestored });
    await network.connect();
    network.socket().halfOpen = true;
    network.runtime.networkRestored();
    await vi.waitFor(() => expect(network.connection().iceRestarts).toBe(1));
    expect({ sockets: network.sockets.length, bootstraps: network.bootstraps() }).toEqual({
      sockets: 2,
      bootstraps: 1,
    });
    expect(onNetworkRestored).toHaveBeenCalledOnce();
    await network.runtime.dispose();
  });

  it("keeps a sent message pending in the background until the desktop confirms it", async () => {
    const arrived = deferred();
    const release = deferred();
    const network = await setupNetwork({
      responseBody: { messageId: "sent-message", deliveries: [] },
      beforeResponse: async () => {
        arrived.resolve();
        await release.promise;
      },
    });
    await network.connect();
    const pending = network.runtime.execute({
      id: "send-message",
      type: "request",
      method: "POST",
      path: "/v1/agents/agent/messages",
      body: { text: "Hello" },
    });
    await arrived.promise;
    network.runtime.setActive(false);
    release.resolve();
    await expect(pending).resolves.toMatchObject({ commandId: "send-message", ok: true, status: 200 });
    await network.runtime.dispose();
  });

  it("releases a pending workspace read on background entry and reuses healthy channels on return", async () => {
    const network = await setupNetwork();
    await network.connect();
    const pending = network.runtime.execute({
      id: "background-read",
      type: "request",
      method: "GET",
      path: "/v1/agents/slow/conversation",
      body: {},
    });
    await network.slowRequest.promise;
    network.runtime.setActive(false);
    await expect(pending).resolves.toMatchObject({ ok: false, error: "The app is in the background." });
    network.runtime.setActive(true);
    await network.connect();
    const result = await network.runtime.execute({
      id: "resumed-read",
      type: "request",
      method: "GET",
      path: "/v1/agents",
      body: {},
    });
    expect({ result, bootstraps: network.bootstraps() }).toEqual({
      result: { commandId: "resumed-read", ok: true, status: 200, body: [] },
      bootstraps: 1,
    });
    await network.runtime.dispose();
  });

  it("waits for RTC recovery on resume even if the browser missed the disconnect event", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const endSession = vi.fn(async () => {});
    const network = await setupNetwork({ endSession });
    await network.connect();
    network.runtime.setActive(false);
    network.connection().connectionState = "disconnected";
    network.runtime.setActive(true);
    const reconnect = network.connect();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(endSession).not.toHaveBeenCalled();
    network.connection().drop("connected");
    await expect(reconnect).resolves.toMatchObject({ ok: true });
    expect(network.bootstraps()).toBe(1);
    await network.runtime.dispose();
  });

  it("keeps an unrecoverable RTC session for the next attempt and ends it on disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const endSession = vi.fn(async () => {});
    const network = await setupNetwork({ endSession });
    await network.connect();
    network.runtime.setActive(false);
    network.connection().drop("disconnected");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endSession).not.toHaveBeenCalled();
    network.runtime.setActive(true);
    const reconnect = network.connect();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(reconnect).resolves.toMatchObject({ ok: false });
    // Each recovery attempt would otherwise create and end a session on the account Worker.
    expect(endSession).not.toHaveBeenCalled();
    await expect(network.connect()).resolves.toMatchObject({ ok: true });
    expect(network.bootstraps()).toBe(2);
    expect(network.keptSessions).toEqual([null, "session-1"]);
    await network.runtime.execute({ id: "disconnect", type: "disconnect" });
    expect(endSession).toHaveBeenCalledWith("session-1");
    await network.runtime.dispose();
  });

  it("keeps the session when the account API cannot issue a ticket", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const endSession = vi.fn(async () => {});
    let accountUnavailable = false;
    let failedBootstraps = 0;
    const network = await setupNetwork({
      endSession,
      beforeBootstrap: async () => {
        if (!accountUnavailable) return;
        failedBootstraps += 1;
        throw new Error("The account API is unavailable.");
      },
    });
    await network.connect();
    network.runtime.setActive(false);
    network.connection().drop("disconnected");
    await vi.advanceTimersByTimeAsync(60_000);
    network.runtime.setActive(true);
    const reconnect = network.connect();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(reconnect).resolves.toMatchObject({ ok: false });
    accountUnavailable = true;
    await expect(network.connect()).resolves.toMatchObject({ ok: false });
    expect(failedBootstraps).toBe(1);
    accountUnavailable = false;
    await expect(network.connect()).resolves.toMatchObject({ ok: true });
    expect(network.keptSessions).toEqual([null, "session-1"]);
    expect(endSession).not.toHaveBeenCalled();
    await network.runtime.dispose();
  });

  it("leaves resume reads to the recovery owner without replacing the healthy peer", async () => {
    const network = await setupNetwork();
    await network.connect();
    network.updates.length = 0;
    network.runtime.setActive(false);
    network.runtime.setActive(true);
    expect(network.updates).toEqual([]);
    const read = network.runtime.execute({
      id: "canceled",
      type: "request",
      method: "GET",
      path: "/v1/agents/slow/conversation",
      body: {},
    });
    await network.slowRequest.promise;
    network.updates.length = 0;
    network.runtime.setActive(false);
    await read;
    network.runtime.setActive(true);
    expect(network.updates).toEqual([]);
    expect(network.bootstraps()).toBe(1);
    await network.runtime.dispose();
  });

  it("detects a restarted desktop instead of reusing the old authenticated data channels", async () => {
    const network = await setupNetwork();
    await network.connect();
    const offline = deferred();
    network.onOffline = () => offline.resolve();
    network
      .socket()
      .receive({ type: "answer", version: 1, channel: "team", connectionId: "connection-1", sdp: sdp("CC:33") });
    await offline.promise;
    expect(network.updates.at(-1)?.state).toBe("offline");
    await expect(network.connect()).resolves.toMatchObject({ ok: true });
    expect(network.bootstraps()).toBe(2);
    await network.runtime.dispose();
  });

  it.each(["error", "close"])("keeps the peer and waits after a Signal rate-limit %s", async (kind) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const network = await setupNetwork();
    await network.connect();
    const socket = network.socket();
    if (kind === "error") {
      socket.receive({ type: "error", version: 1, code: "rate_limited", message: "Too many signal messages." });
      await vi.waitFor(() => expect(socket.readyState).toBe(3));
    } else socket.close(1008);
    network.runtime.setActive(false);
    network.runtime.setActive(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(network.sockets).toHaveLength(1);
    expect(network.updates.filter((update) => update.state === "offline")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(network.sockets).toHaveLength(2);
    expect(network.bootstraps()).toBe(1);
    expect(network.connections).toHaveLength(1);
    await network.runtime.dispose();
  });

  it.each(["initial", "replacement"])("excludes the rate wait from the %s connection timeout", async (kind) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let refuseHello = kind === "initial";
    const network = await setupNetwork({ refuseHello: () => refuseHello });
    if (kind === "replacement") {
      await network.connect();
      network.socket().close(1008);
      const offline = deferred();
      network.onOffline = () => offline.resolve();
      network.connection().drop("closed");
      await offline.promise;
    }
    const connecting = network.connect();
    await vi.waitFor(() => expect(network.bootstraps()).toBe(kind === "initial" ? 1 : 2));
    if (kind === "initial") await vi.waitFor(() => expect(network.socket().readyState).toBe(3));
    network.updates.length = 0;
    refuseHello = false;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(network.sockets).toHaveLength(1);
    expect(network.updates.filter((update) => update.state === "offline")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(connecting).resolves.toMatchObject({ ok: true });
    expect(network.sockets).toHaveLength(2);
    await network.runtime.dispose();
  });

  it("still times out an active connection attempt after 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const offered = deferred();
    const answer = deferred();
    const network = await setupNetwork({
      beforeAnswer: () => {
        offered.resolve();
        return answer.promise;
      },
    });
    const connecting = network.connect();
    await offered.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(connecting).resolves.toMatchObject({ ok: false });
    expect(network.updates.at(-1)?.state).toBe("offline");
    answer.resolve();
    await network.runtime.dispose();
  });

  it("suspends Signal reconnects in the background and resumes healthy data channels without a new ticket", async () => {
    // Fake only timers: network and cryptographic callbacks still run as ordinary microtasks.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const network = await setupNetwork();
    await network.connect();
    network.socket().close();
    network.runtime.setActive(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(network.sockets).toHaveLength(1);
    network.runtime.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(network.sockets).toHaveLength(2);
    expect(network.bootstraps()).toBe(1);
    await network.runtime.dispose();
  });

  // The peer stops itself either way, but the consumer decides whether to reconnect, and mobile
  // hands every plain offline update to `recovery.offline`. A frame Signal would send again is the
  // one failure that must not go back into that loop.
  it("reports a frame it cannot read as a protocol error rather than a lost connection", async () => {
    const network = await setupNetwork();
    await network.connect();
    const offline = deferred();
    network.onOffline = () => offline.resolve();
    // A known frame type carrying a resume token no session could have.
    network.socket().receive({ type: "ready", version: 1, connectionId: null, resumeToken: "", iceServers: [] });
    await offline.promise;
    expect(network.updates.at(-1)).toMatchObject({ state: "offline", code: "protocol_error" });
    await network.runtime.dispose();
  });

  it("reports event-buffer loss so the workspace can reload cached conversations", async () => {
    const network = await setupNetwork();
    await network.connect();
    const reset = deferred();
    network.onReset = () => reset.resolve();
    network
      .connection()
      .channel(TEAM_PROTOCOL_V2_CHANNELS.events)
      .receive(encodeTeamProtocolV2Frame({ version: 2, type: "event-reset", nextSequence: 2001 }));
    await reset.promise;
    expect(network.updates.at(-1)).toMatchObject({ hostId: "host", resync: true });
    await network.runtime.dispose();
  });
});

describe("connection failure references", () => {
  const SERVER_TEXT = "Signal server text.";
  const signalError = (code: string): TeamProtocolV2Json => ({ type: "error", version: 1, code, message: SERVER_TEXT });
  interface SignalFailure {
    name: string;
    frame: TeamProtocolV2Json;
    state: RemoteTeamConnectionUpdate["state"];
    message: string;
    reference: string;
  }
  const SIGNAL_FAILURES: SignalFailure[] = [
    ...(
      [
        ["authentication_required", "error.remote.ticketInvalidOrExpired"],
        ["invalid_message", "error.remote.signalInvalidMessage"],
        ["host_unavailable", "error.remote.hostOffline"],
        ["host_busy", "error.remote.hostBusy"],
        ["permission_denied", "error.remote.signalPermissionDenied"],
        ["protocol_error", "error.remote.signalProtocolError"],
        ["code_from_a_newer_signal", "error.remote.signalRefused"],
      ] satisfies [string, keyof SourceMessages][]
    ).map(
      ([code, key]): SignalFailure => ({
        name: `Signal ${code}`,
        frame: signalError(code),
        state: "offline",
        message: sourceText(key),
        reference: `signal/${code}`,
      }),
    ),
    {
      name: "Signal session_revoked",
      frame: signalError("session_revoked"),
      state: "offline",
      message: SERVER_TEXT,
      reference: "signal/session_revoked",
    },
    {
      name: "Signal rate_limited",
      frame: signalError("rate_limited"),
      state: "connecting",
      message: sourceText("error.remote.signalRateLimited", { seconds: 60 }),
      reference: "signal/rate_limited",
    },
    {
      name: "a Signal ready with no relay servers",
      frame: { type: "ready", version: 1, connectionId: "connection-1", resumeToken: "resume", iceServers: [] },
      state: "offline",
      message: sourceText("error.remote.relayUnavailable"),
      reference: "signal/no_ice_servers",
    },
  ];

  it.each(SIGNAL_FAILURES)("names $name", async ({ frame, state, message, reference }) => {
    const offered = deferred();
    const answer = deferred();
    const network = await setupNetwork({
      beforeAnswer: () => {
        offered.resolve();
        return answer.promise;
      },
    });
    void network.connect();
    await offered.promise;
    network.socket().receive(frame);
    // The exact message also shows that no Signal text passes, except where a revoked session keeps it.
    await vi.waitFor(() => expect(network.updates.at(-1)).toMatchObject({ state, message, reference }));
    answer.resolve();
    await network.runtime.dispose();
  });

  const PATH_ENDS: {
    name: string;
    drop: string | null;
    key: "error.remote.iceFailed" | "error.remote.iceDisconnected" | "error.remote.desktopDidNotConnect";
    reference: string;
  }[] = [
    { name: "a failed ICE path", drop: "failed", key: "error.remote.iceFailed", reference: "webrtc/ice/failed" },
    {
      name: "a disconnected ICE path after the grace period",
      drop: "disconnected",
      key: "error.remote.iceDisconnected",
      reference: "webrtc/ice/disconnected",
    },
    { name: "a closed ICE path", drop: "closed", key: "error.remote.iceDisconnected", reference: "webrtc/ice/closed" },
    {
      name: "a connection whose ICE step does not finish",
      drop: null,
      key: "error.remote.desktopDidNotConnect",
      reference: "timeout/connect/ice",
    },
  ];

  it.each(PATH_ENDS)("names $name", async ({ drop, key, reference }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const answer = deferred();
    const network = await setupNetwork({ beforeAnswer: () => (drop ? Promise.resolve() : answer.promise) });
    const connecting = network.connect();
    if (drop) {
      await expect(connecting).resolves.toMatchObject({ ok: true });
      network.connection().drop(drop);
    }
    await vi.advanceTimersByTimeAsync(30_000);
    expect(network.updates.at(-1)).toMatchObject({ state: "offline", message: sourceText(key), reference });
    if (!drop) await expect(connecting).resolves.toMatchObject({ ok: false, reference });
    answer.resolve();
    await network.runtime.dispose();
  });
});

describe("native command mailbox", () => {
  it("keeps in-flight requests when a foreground refresh reuses the same host", async () => {
    const mailbox = createRemoteCommandMailbox(() => {});
    const connect = { id: "connect", type: "connect", hostId: "host", hostPublicKey: "key" } as const;
    const initial = mailbox.send(connect);
    mailbox.receive({ commandId: connect.id, ok: true });
    await initial;
    const reading = mailbox.send({ id: "read", type: "request", method: "GET", path: "/v1/agents", body: {} });
    const refresh = mailbox.send({ ...connect, id: "refresh" });
    mailbox.receive({ commandId: "refresh", ok: true });
    await refresh;
    mailbox.receive({ commandId: "read", ok: true, body: ["agent"] });
    await expect(reading).resolves.toMatchObject({ ok: true, body: ["agent"] });
  });
  it("delivers concurrent RPC results by ID instead of blocking behind a slow request", async () => {
    let published: RemoteTeamCommand[] = [];
    const mailbox = createRemoteCommandMailbox((commands) => {
      published = commands;
    });
    const slow = mailbox.send({ id: "slow", type: "request", method: "GET", path: "/slow", body: {} });
    const fast = mailbox.send({ id: "fast", type: "request", method: "GET", path: "/fast", body: {} });
    expect(published.map((command) => command.id)).toEqual(["slow", "fast"]);
    mailbox.receive({ commandId: "fast", ok: true, body: "fast response" });
    await expect(fast).resolves.toMatchObject({ body: "fast response" });
    mailbox.receive({ commandId: "slow", ok: true, body: "slow response" });
    await expect(slow).resolves.toMatchObject({ body: "slow response" });
    expect(published).toEqual([]);
  });

  it.each(["connect", "disconnect"] as const)(
    "%s preempts old commands and ignores their late results",
    async (type) => {
      let published: RemoteTeamCommand[] = [];
      const mailbox = createRemoteCommandMailbox((commands) => {
        published = commands;
      });
      const pending = mailbox.send({ id: "old", type: "request", method: "GET", path: "/slow", body: {} });
      const next = mailbox.send(
        type === "connect" ? { id: "next", type, hostId: "new-host", hostPublicKey: "key" } : { id: "next", type },
      );
      expect(published.map((command) => command.id)).toEqual(["next"]);
      await expect(pending).resolves.toMatchObject({ ok: false });
      mailbox.receive({ commandId: "old", ok: true, body: "stale" });
      expect(published.map((command) => command.id)).toEqual(["next"]);
      mailbox.receive({ commandId: "next", ok: true });
      await expect(next).resolves.toMatchObject({ ok: true });
      const abandoned = mailbox.send({ id: "abandoned", type: "request", method: "GET", path: "/slow", body: {} });
      mailbox.dispose();
      await expect(abandoned).resolves.toMatchObject({ ok: false });
    },
  );
});

function sdp(fingerprint: string) {
  return `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setupNetwork(
  options: {
    onHostStreamData?: (data: string | ArrayBuffer) => void;
    onTeamEvent?: (hostId: string, event: AgentEvent | TeamRealtimeEvent) => Promise<void>;
    onAccountProfileChanged?: () => Promise<void>;
    onAccountServersChanged?: () => Promise<void>;
    onNetworkRestored?: () => Promise<void>;
    endSession?: () => Promise<void>;
    beforeBootstrap?: (hostId: string) => Promise<void>;
    beforeAnswer?: () => Promise<void>;
    refuseHello?: () => boolean;
    beforeResponse?: () => Promise<void>;
    responseBody?: TeamProtocolV2Json;
    responseFile?: TeamProtocolV2Json;
  } = {},
) {
  const host = await runTeamEffect(createEd25519Identity(() => new Uint8Array(32).fill(7)));
  const sockets: TestSocket[] = [];
  const connections: TestConnection[] = [];
  const updates: RemoteTeamConnectionUpdate[] = [];
  const uploadProgress: RemoteUploadProgress[] = [];
  let bootstrapCount = 0;
  const keptSessions: (string | null)[] = [];
  let currentSessionId = "";
  let currentHostId = "host";
  const slowRequest = deferred();
  const callbacks = { onOffline: () => {}, onReset: () => {} };
  const connection = () => {
    const value = connections.at(-1);
    if (!value) throw new Error("No peer");
    return value;
  };
  const socket = () => {
    const value = sockets.at(-1);
    if (!value) throw new Error("No Signal socket");
    return value;
  };

  class TestSocket {
    static OPEN = 1;
    readyState = 1;
    halfOpen = false;
    onopen: (() => void) | null = null;
    onclose: ((event?: { code: number }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor() {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    receive(value: TeamProtocolV2Json) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
    send(data: string) {
      if (this.halfOpen) return;
      const message = JSON.parse(data);
      if (message.type === "hello" && options.refuseHello?.()) {
        queueMicrotask(() => this.close(1008));
        return;
      }
      if (message.type === "hello")
        queueMicrotask(() =>
          this.receive({
            type: "ready",
            version: 1,
            connectionId: `connection-${bootstrapCount}`,
            resumeToken: "resume",
            iceServers: [{ urls: "stun:localhost" }],
          }),
        );
      if (message.type === "offer")
        queueMicrotask(async () => {
          await options.beforeAnswer?.();
          this.receive({
            type: "answer",
            version: 1,
            channel: "team",
            connectionId: message.connectionId,
            sdp: sdp("BB:22"),
          });
        });
    }
    close(code?: number) {
      this.readyState = 3;
      this.onclose?.(code === undefined ? undefined : { code });
    }
  }

  class TestChannel extends EventTarget {
    readyState = "connecting";
    bufferedAmount = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly label: string) {
      super();
    }
    receive(data: string | ArrayBuffer) {
      this.onmessage?.({ data });
    }
    send(data: string) {
      const frame = JSON.parse(data);
      if (!isDynamicRecord(frame)) throw new Error("Invalid client frame");
      if (frame.type === "auth-init") {
        if (!isString(frame.ticket) || !isString(frame.clientPublicKey) || !isString(frame.clientNonce))
          throw new Error("Invalid auth");
        const clientNonce = frame.clientNonce;
        const hostNonce = "h".repeat(43);
        const transcript = teamProtocolV2AuthenticationTranscript({
          hostId: currentHostId,
          sessionId: currentSessionId,
          ticket: frame.ticket,
          clientPublicKey: frame.clientPublicKey,
          clientNonce,
          hostNonce,
          clientFingerprint: "AA:11",
          hostFingerprint: "BB:22",
        });
        void runTeamEffect(signEd25519(new TextEncoder().encode(transcript), host.secretKey)).then((signature) =>
          this.receive(
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "auth-ready",
              clientNonce,
              hostNonce,
              signature: btoa(String.fromCharCode(...signature))
                .replaceAll("+", "-")
                .replaceAll("/", "_")
                .replaceAll("=", ""),
            }),
          ),
        );
      } else if (frame.type === "auth-complete") {
        this.receive(JSON.stringify({ ...frame, type: "auth-confirmed" }));
      } else if (frame.type === "request") {
        if (isDynamicRecord(frame.payload) && frame.payload.path === "/v1/agents/slow/conversation") {
          slowRequest.resolve();
          return;
        }
        void (async () => {
          await options.beforeResponse?.();
          this.receive(
            JSON.stringify({
              version: 2,
              type: "response",
              requestId: frame.requestId,
              result: options.responseFile
                ? { status: 200, body: null, file: options.responseFile }
                : { status: 200, body: options.responseBody ?? [] },
            }),
          );
        })();
      }
    }
  }

  class TestConnection {
    onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
    connectionState = "new";
    localDescription: RTCSessionDescriptionInit | null = null;
    remoteDescription: RTCSessionDescriptionInit | null = null;
    onconnectionstatechange: (() => void) | null = null;
    readonly channels = new Map<string, TestChannel>();
    constructor() {
      connections.push(this);
    }
    channel(label: string) {
      const value = this.channels.get(label);
      if (!value) throw new Error("No channel");
      return value;
    }
    createDataChannel(label: string) {
      const value = new TestChannel(label);
      this.channels.set(label, value);
      return value;
    }
    async createOffer() {
      return { type: "offer", sdp: sdp("AA:11") };
    }
    async setLocalDescription(value: RTCSessionDescriptionInit) {
      this.localDescription = value;
    }
    async setRemoteDescription(value: RTCSessionDescriptionInit) {
      this.remoteDescription = value;
      // An ICE restart answer does not bring the path back by itself; a test calls `drop("connected")`.
      if (this.connectionState !== "new") return;
      this.connectionState = "connected";
      this.onconnectionstatechange?.();
      for (const channel of this.channels.values()) {
        channel.readyState = "open";
        channel.onopen?.();
      }
    }
    setConfiguration() {}
    iceRestarts = 0;
    restartIce() {
      this.iceRestarts += 1;
    }
    drop(state: string) {
      this.connectionState = state;
      this.onconnectionstatechange?.();
    }
    close() {
      this.drop("closed");
    }
  }

  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal("RTCPeerConnection", TestConnection);
  const runtime = createRemoteTeamPeer({
    current: {
      getBootstrap: async (hostId, _clientPublicKey, existingSessionId) => {
        await options.beforeBootstrap?.(hostId);
        currentHostId = hostId;
        bootstrapCount += 1;
        keptSessions.push(existingSessionId);
        currentSessionId = existingSessionId ?? `session-${bootstrapCount}`;
        return {
          sessionId: currentSessionId,
          signalUrl: "wss://signal",
          ticket: "ticket",
        };
      },
      endSession: options.endSession ?? (async () => {}),
      onUploadProgress: async (progress) => {
        uploadProgress.push(progress);
      },
      onAccountProfileChanged: options.onAccountProfileChanged,
      onAccountServersChanged: options.onAccountServersChanged,
      onNetworkRestored: options.onNetworkRestored,
      onHostStreamData: options.onHostStreamData,
      onTeamEvent: options.onTeamEvent ?? (async () => {}),
      onConnectionUpdate: async (update) => {
        updates.push(update);
        if (update.state === "offline") callbacks.onOffline();
        if (update.resync) callbacks.onReset();
      },
    },
  });
  return {
    runtime,
    slowRequest,
    sockets,
    connections,
    updates,
    uploadProgress,
    connection,
    socket,
    bootstraps: () => bootstrapCount,
    keptSessions,
    connect: (hostId = "host") =>
      runtime.execute({
        id: `connect-${bootstrapCount}`,
        type: "connect",
        hostId,
        hostPublicKey: host.publicKeyPem,
      }),
    set onOffline(callback: () => void) {
      callbacks.onOffline = callback;
    },
    set onReset(callback: () => void) {
      callbacks.onReset = callback;
    },
  };
}
