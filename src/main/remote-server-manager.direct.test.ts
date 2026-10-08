// @vitest-environment node

// The direct Tailscale path of a joined WebRTC server, through the manager: which transport a
// connection uses, and what reaches the direct address before the host key is checked.

import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import type { RemoteHostSummary } from "./central-auth-records";
import { RemoteDirectSessionStore } from "./remote-direct-session-store";
import {
  createRemoteManager,
  fakeWebRtcTransport,
  stopRemoteFixtures,
  storedHttpsServer,
  stubEventSockets,
  stubTeamFetch,
  waitForServer,
} from "./remote-server-test-harness";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TailscaleLocalState } from "./tailscale-cli";
import { fingerprint } from "./team-store";

afterEach(async () => {
  await stopRemoteFixtures();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HOST = "00000000-0000-4000-8000-0000000000aa";
const DIRECT = "https://studio-mac.tail4b2c1.ts.net";
function pemKeys(): { publicKey: string; privateKey: string } {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
const hostKeys = pemKeys();
const otherKeys = pemKeys();

const tailnet: TailscaleLocalState = {
  kind: "connected",
  tailnet: "owner@example.com",
  deviceName: "laptop",
  dnsName: "laptop.tail4b2c1.ts.net",
  httpsCertificates: true,
  peerDnsNames: ["studio-mac.tail4b2c1.ts.net"],
};

function listedHost(): RemoteHostSummary {
  return {
    hostId: HOST,
    name: "Studio",
    logoKey: null,
    devicePublicKey: hostKeys.publicKey,
    authEpoch: 1,
    membershipId: "membership-1",
    role: "member",
  };
}

const member = {
  id: "membership-1",
  username: "person@example.com",
  email: "person@example.com",
  name: null,
  avatarUrl: null,
  role: "member",
  createdAt: "2026-10-01T00:00:00.000Z",
  disabled: false,
};

/**
 * The host at the direct address. `keys` signs the identity challenge. `sessions` holds the tokens it
 * accepts, as the host's memory does: a new host process starts with none.
 */
function directHost(keys: { publicKey: string; privateKey: string } = hostKeys, sessions = new Set<string>()) {
  let issued = 0;
  return stubTeamFetch({
    compatibility: {
      appVersion: "1.0.0",
      protocol: { minimum: 1, maximum: 6 },
      capabilities: ["agent-runtime-snapshots"],
    },
    routes: {
      [TEAM_API_ROUTES.identity]: (call) => {
        const challenge = call.url.searchParams.get("challenge") ?? "";
        return Response.json({
          serverId: HOST,
          serverName: "Studio",
          fingerprint: fingerprint(keys.publicKey),
          publicKey: keys.publicKey,
          enabledOnLaunch: true,
          logoVersion: null,
          challenge,
          signature: sign(null, Buffer.from(challenge), keys.privateKey).toString("base64url"),
        });
      },
      [TEAM_API_ROUTES.auth.account]: () => {
        issued += 1;
        const sessionToken = issued === 1 ? "direct-session-token" : `direct-session-token-${issued}`;
        sessions.add(sessionToken);
        return Response.json({
          member,
          sessionToken,
          sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
      },
      [TEAM_API_ROUTES.me]: (call) => {
        const token = call.headers.get("Authorization")?.replace(/^Bearer /u, "") ?? "";
        return sessions.has(token)
          ? Response.json(member)
          : Response.json({ error: "Authentication is required." }, { status: 401 });
      },
      [TEAM_API_ROUTES.remoteScreen.capabilities]: () => Response.json({ ready: false }),
    },
  });
}

async function directFixture(
  options: {
    directUrl?: string;
    localTailscale?: TailscaleLocalState;
    sessionsPath?: string;
    principalId?: string;
    ticket?: () => Effect.Effect<string>;
    account?: { getPrincipalId?: () => string | null; ready?: () => Effect.Effect<void> };
  } = {},
) {
  const transport = fakeWebRtcTransport([listedHost()]);
  const connect = vi.spyOn(transport, "connect").mockReturnValue(Effect.void);
  const createTeamAuthTicket = vi.fn(options.ticket ?? (() => Effect.succeed("account-ticket")));
  const fixture = await createRemoteManager({
    appVersion: "1.0.0",
    servers: [
      storedHttpsServer(HOST, {
        transport: "webrtc-v2",
        apiUrl: `webrtc://${HOST}`,
        fingerprint: fingerprint(hostKeys.publicKey),
        publicKey: hostKeys.publicKey,
        encryptedToken: "",
        ...("directUrl" in options ? { directUrl: options.directUrl } : { directUrl: DIRECT }),
      }),
    ],
    account: { createTeamAuthTicket, getPrincipalId: () => options.principalId ?? "user-1", ...options.account },
    managerOptions: {
      webrtcTransport: transport,
      localTailscale: () => Effect.succeed(options.localTailscale ?? tailnet),
      ...(options.sessionsPath ? { directSessions: sessionStore(options.sessionsPath) } : {}),
    },
  });
  return { ...fixture, connect, createTeamAuthTicket, transport };
}

function sessionStore(path: string): RemoteDirectSessionStore {
  return new RemoteDirectSessionStore({
    path,
    canPersist: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
}

/** The token that the next run of the app would find, read as a new run reads it. */
async function keptToken(path: string, principalId = "user-1"): Promise<string | null> {
  const store = sessionStore(path);
  await Effect.runPromise(store.load());
  return store.get(principalId, HOST)?.token ?? null;
}

async function sessionsFile(): Promise<{ path: string; remove: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-direct-sessions-"));
  return {
    path: join(directory, "openbot-direct-sessions-v1.bin"),
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

describe("RemoteServerManager direct Tailscale path", () => {
  it("connects over the direct address when Tailscale reaches the host, and never opens WebRTC", async () => {
    const host = directHost();
    const sockets = stubEventSockets();
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await waitForServer(fixture, { state: "online" }, HOST);

    expect(fixture.connect).not.toHaveBeenCalled();
    expect(fixture.manager.directRouteStatus(HOST)).toEqual({ offered: true, enabled: true, active: true, hint: null });
    // The identity check comes before any secret: the ticket goes out once, to the checked address.
    const paths = host.calls.map((call) => call.path);
    expect(paths.indexOf(TEAM_API_ROUTES.identity)).toBeLessThan(paths.indexOf(TEAM_API_ROUTES.auth.account));
    expect(host.calls.every((call) => call.url.origin === DIRECT)).toBe(true);
    expect(host.requests(TEAM_API_ROUTES.auth.account).map((call) => call.body)).toEqual([
      { accountTicket: "account-ticket" },
    ]);
    expect(fixture.createTeamAuthTicket).toHaveBeenCalledOnce();
    const socket = sockets.last();
    expect(socket?.url).toBe(`wss://studio-mac.tail4b2c1.ts.net${TEAM_API_ROUTES.events}`);
    expect(socket?.protocols).toContain("openbot-token.direct-session-token");
  });

  it("sends no ticket to an address that answers with another key, and uses WebRTC", async () => {
    const host = directHost(otherKeys);
    stubEventSockets();
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledWith(HOST));

    expect(host.requests(TEAM_API_ROUTES.auth.account)).toEqual([]);
    expect(fixture.createTeamAuthTicket).not.toHaveBeenCalled();
    expect(host.calls.some((call) => call.headers.has("Authorization"))).toBe(false);
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ active: false, hint: "failed" });
  });

  it("uses WebRTC when the direct address does not answer", async () => {
    stubTeamFetch({
      fallback: () => {
        throw new TypeError("fetch failed");
      },
    });
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledWith(HOST));
    expect(fixture.createTeamAuthTicket).not.toHaveBeenCalled();
  });

  it("keeps a server whose host never offered an address on WebRTC, without asking Tailscale", async () => {
    const host = stubTeamFetch();
    const localTailscale = vi.fn(() => Effect.succeed(tailnet));
    const transport = fakeWebRtcTransport([listedHost()]);
    const connect = vi.spyOn(transport, "connect").mockReturnValue(Effect.void);
    const fixture = await createRemoteManager({
      appVersion: "1.0.0",
      servers: [
        storedHttpsServer(HOST, {
          transport: "webrtc-v2",
          apiUrl: `webrtc://${HOST}`,
          fingerprint: fingerprint(hostKeys.publicKey),
          publicKey: hostKeys.publicKey,
          encryptedToken: "",
        }),
      ],
      managerOptions: { webrtcTransport: transport, localTailscale },
    });
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(connect).toHaveBeenCalledWith(HOST));
    expect(localTailscale).not.toHaveBeenCalled();
    expect(host.calls).toEqual([]);
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ offered: false, active: false });
  });

  it("explains a host in another tailnet and stays on WebRTC", async () => {
    const host = stubTeamFetch();
    const fixture = await directFixture({ localTailscale: { ...tailnet, peerDnsNames: [] } });
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledWith(HOST));
    expect(host.calls).toEqual([]);
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ active: false, hint: "other-tailnet" });
  });

  it("asks a connected host for its address only when it offers the capability", async () => {
    for (const capabilities of [["direct-endpoint-v1"], []]) {
      const transport = fakeWebRtcTransport([listedHost()]);
      vi.spyOn(transport, "connect").mockReturnValue(Effect.void);
      const asked: string[] = [];
      vi.spyOn(transport, "request").mockImplementation((_hostId, path) => {
        asked.push(path);
        if (path === TEAM_API_ROUTES.compatibility)
          return Effect.succeed({ appVersion: "1.0.0", protocol: { minimum: 1, maximum: 6 }, capabilities });
        if (path === "/v1/direct-endpoint") return Effect.succeed({ url: DIRECT });
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("not in this test") }));
      });
      const fixture = await createRemoteManager({
        appVersion: "1.0.0",
        servers: [
          storedHttpsServer(HOST, {
            transport: "webrtc-v2",
            apiUrl: `webrtc://${HOST}`,
            fingerprint: fingerprint(hostKeys.publicKey),
            publicKey: hostKeys.publicKey,
            encryptedToken: "",
            directUrl: "https://old-name.tail4b2c1.ts.net",
          }),
        ],
        managerOptions: { webrtcTransport: transport, localTailscale: () => Effect.succeed(tailnet) },
      });
      transport.emit("connected", HOST);
      const expected = capabilities.length ? DIRECT : undefined;
      await vi.waitFor(() => expect(fixture.manager.directRouteStatus(HOST)?.offered).toBe(expected !== undefined));
      expect(asked.includes("/v1/direct-endpoint")).toBe(capabilities.length > 0);
    }
  });

  it("goes back to WebRTC when the direct connection drops", async () => {
    directHost();
    const sockets = stubEventSockets();
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await waitForServer(fixture, { state: "online" }, HOST);
    sockets.last()?.close(1000, "Tailscale went away");
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledWith(HOST), { timeout: 5_000 });
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ active: false, hint: "failed" });
  });

  it("signs in again, not 'sign in again', when the host no longer accepts the direct session", async () => {
    const host = directHost();
    stubEventSockets();
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await waitForServer(fixture, { state: "online" }, HOST);
    host.fetch.mockImplementationOnce(async () => Response.json({ error: "Sign in is required." }, { status: 401 }));
    await expect(
      runCauseEffect(fixture.manager.request(HOST, TEAM_API_ROUTES.me, (value) => value)),
    ).rejects.toBeDefined();
    await vi.waitFor(() => expect(fixture.manager.directRouteStatus(HOST)?.active).toBe(true));
    expect(fixture.createTeamAuthTicket).toHaveBeenCalledTimes(2);
    await waitForServer(fixture, { state: "online", issue: null }, HOST);
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("moves back to WebRTC at once when the member turns the direct path off", async () => {
    directHost();
    stubEventSockets();
    const fixture = await directFixture();
    await runCauseEffect(fixture.manager.startEventConnections());
    await waitForServer(fixture, { state: "online" }, HOST);
    await runCauseEffect(fixture.manager.setDirectEnabled(HOST, false));
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledWith(HOST));
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ enabled: false, active: false });
  });

  it("holds a request made during the direct attempt, then sends it over the direct path", async () => {
    const host = directHost();
    stubEventSockets();
    const ticket = Deferred.makeUnsafe<string>();
    const ready = vi.fn(() => Effect.void);
    const fixture = await directFixture({ ticket: () => Deferred.await(ticket), account: { ready } });
    const webRtcRequest = vi.spyOn(fixture.transport, "request");
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(fixture.createTeamAuthTicket).toHaveBeenCalledOnce());

    let settled = false;
    const request = runCauseEffect(fixture.manager.request(HOST, TEAM_API_ROUTES.me, (value) => value)).finally(() => {
      settled = true;
    });
    // The attempt asked for the account, and so did the request: it now waits for the attempt.
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(host.requests(TEAM_API_ROUTES.me)).toEqual([]);

    Deferred.doneUnsafe(ticket, Effect.succeed("account-ticket"));
    expect(await request).toMatchObject({ id: member.id });
    expect(host.requests(TEAM_API_ROUTES.me).map((call) => call.headers.get("Authorization"))).toEqual([
      "Bearer direct-session-token",
    ]);
    expect(webRtcRequest).not.toHaveBeenCalled();
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it("makes one direct attempt when a retry comes while the event stream connects", async () => {
    const host = directHost();
    stubEventSockets();
    const ticket = Deferred.makeUnsafe<string>();
    const fixture = await directFixture({ ticket: () => Deferred.await(ticket) });
    await runCauseEffect(fixture.manager.startEventConnections());
    await vi.waitFor(() => expect(fixture.createTeamAuthTicket).toHaveBeenCalledOnce());
    const retry = runCauseEffect(fixture.manager.retryConnection(HOST));
    Deferred.doneUnsafe(ticket, Effect.succeed("account-ticket"));
    await retry;
    await waitForServer(fixture, { state: "online" }, HOST);

    expect(fixture.createTeamAuthTicket).toHaveBeenCalledOnce();
    expect(host.requests(TEAM_API_ROUTES.auth.account)).toHaveLength(1);
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(fixture.manager.directRouteStatus(HOST)).toEqual({ offered: true, enabled: true, active: true, hint: null });
  });

  it("holds an early request until the account has loaded, instead of failing it at once", async () => {
    const host = directHost();
    stubEventSockets();
    const principal: { id: string | null } = { id: null };
    const loaded = Deferred.makeUnsafe<void>();
    const ready = vi.fn(() => Deferred.await(loaded));
    const fixture = await directFixture({ account: { getPrincipalId: () => principal.id, ready } });
    // While the account loads, the WebRTC transport cannot reach the host and fails at once.
    const webRtcRequest = vi
      .spyOn(fixture.transport, "request")
      .mockReturnValue(Effect.fail(new RemoteWorkflowError({ cause: new Error("Sign in first.") })));

    // The renderer asks before the event stream starts.
    const request = runCauseEffect(fixture.manager.request(HOST, TEAM_API_ROUTES.me, (value) => value));
    await runCauseEffect(fixture.manager.startEventConnections());
    // The request and the direct attempt both wait for the account.
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
    expect(host.calls).toEqual([]);
    expect(webRtcRequest).not.toHaveBeenCalled();

    principal.id = "user-1";
    Deferred.doneUnsafe(loaded, Effect.void);
    expect(await request).toMatchObject({ id: member.id });
    await waitForServer(fixture, { state: "online" }, HOST);
    expect(webRtcRequest).not.toHaveBeenCalled();
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(fixture.manager.directRouteStatus(HOST)).toMatchObject({ active: true, hint: null });
  });

  describe("kept sessions", () => {
    let file: { path: string; remove: () => Promise<void> } | null = null;
    afterEach(async () => {
      await file?.remove();
      file = null;
    });

    async function online(sessionsPath: string, principalId?: string) {
      const fixture = await directFixture({ sessionsPath, ...(principalId ? { principalId } : {}) });
      await runCauseEffect(fixture.manager.startEventConnections());
      await waitForServer(fixture, { state: "online" }, HOST);
      return fixture;
    }

    it("connects after a restart of the app with the kept session: no ticket and no new sign-in", async () => {
      file = await sessionsFile();
      const host = directHost();
      const sockets = stubEventSockets();
      const first = await online(file.path);
      expect(first.createTeamAuthTicket).toHaveBeenCalledOnce();
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token"));
      await Effect.runPromise(first.manager.stop());

      const second = await online(file.path);
      expect(second.createTeamAuthTicket).not.toHaveBeenCalled();
      expect(second.connect).not.toHaveBeenCalled();
      expect(host.requests(TEAM_API_ROUTES.auth.account)).toHaveLength(1);
      // The pinned key is checked again first, and the kept token goes only to the checked address.
      const paths = host.calls.map((call) => call.path);
      expect(paths.lastIndexOf(TEAM_API_ROUTES.identity)).toBeLessThan(paths.lastIndexOf(TEAM_API_ROUTES.me));
      expect(host.calls.every((call) => call.url.origin === DIRECT)).toBe(true);
      expect(sockets.last()?.protocols).toContain("openbot-token.direct-session-token");
    });

    it("signs in once when the host restarted and lost the session, and keeps the new one", async () => {
      file = await sessionsFile();
      const sessions = new Set<string>();
      const host = directHost(hostKeys, sessions);
      stubEventSockets();
      const first = await online(file.path);
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token"));
      await Effect.runPromise(first.manager.stop());

      sessions.clear();
      const second = await online(file.path);
      expect(second.createTeamAuthTicket).toHaveBeenCalledOnce();
      expect(second.connect).not.toHaveBeenCalled();
      expect(host.requests(TEAM_API_ROUTES.auth.account)).toHaveLength(2);
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token-2"));
    });

    it("forgets the kept session when a request gets 401, and signs in again", async () => {
      file = await sessionsFile();
      const sessions = new Set<string>();
      directHost(hostKeys, sessions);
      stubEventSockets();
      const fixture = await online(file.path);
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token"));
      sessions.clear();
      await expect(
        runCauseEffect(fixture.manager.request(HOST, TEAM_API_ROUTES.me, (value) => value)),
      ).rejects.toBeDefined();
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token-2"));
      await waitForServer(fixture, { state: "online", issue: null }, HOST);
      expect(fixture.createTeamAuthTicket).toHaveBeenCalledTimes(2);
    });

    it("does not use another account's session after a restart", async () => {
      file = await sessionsFile();
      const host = directHost();
      stubEventSockets();
      const first = await online(file.path, "user-1");
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token"));
      await Effect.runPromise(first.manager.stop());

      const second = await online(file.path, "user-2");
      expect(second.createTeamAuthTicket).toHaveBeenCalledOnce();
      expect(host.requests(TEAM_API_ROUTES.me)).toEqual([]);
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "", "user-2")).toBe("direct-session-token-2"));
      expect(await keptToken(file.path, "user-1")).toBeNull();
    });

    it("removes the kept session when the member turns the path off, signs out, or removes the server", async () => {
      const exists = (path: string) =>
        stat(path).then(
          () => true,
          () => false,
        );
      for (const leave of ["disable", "sign-out", "remove"] as const) {
        file = await sessionsFile();
        directHost();
        stubEventSockets();
        const fixture = await online(file.path);
        await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBe("direct-session-token"));
        if (leave === "disable") await runCauseEffect(fixture.manager.setDirectEnabled(HOST, false));
        if (leave === "sign-out") await runCauseEffect(fixture.manager.disconnectRemoteSessions());
        if (leave === "remove") await runCauseEffect(fixture.manager.remove(HOST));
        const path = file.path;
        await vi.waitFor(async () => expect(await exists(path)).toBe(false));
        await stopRemoteFixtures();
        await file.remove();
        file = null;
      }
    });

    it("removes the kept session when the host tells another address", async () => {
      file = await sessionsFile();
      const old = "https://old-name.tail4b2c1.ts.net";
      await Effect.runPromise(
        sessionStore(file.path).set("user-1", HOST, {
          url: old,
          token: "old-token-0123456789",
          expiresAt: Date.now() + 86_400_000,
        }),
      );
      const transport = fakeWebRtcTransport([listedHost()]);
      vi.spyOn(transport, "connect").mockReturnValue(Effect.void);
      vi.spyOn(transport, "request").mockImplementation((_hostId, path) => {
        if (path === TEAM_API_ROUTES.compatibility)
          return Effect.succeed({
            appVersion: "1.0.0",
            protocol: { minimum: 1, maximum: 6 },
            capabilities: ["direct-endpoint-v1"],
          });
        if (path === "/v1/direct-endpoint") return Effect.succeed({ url: DIRECT });
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("not in this test") }));
      });
      const fixture = await createRemoteManager({
        appVersion: "1.0.0",
        servers: [
          storedHttpsServer(HOST, {
            transport: "webrtc-v2",
            apiUrl: `webrtc://${HOST}`,
            fingerprint: fingerprint(hostKeys.publicKey),
            publicKey: hostKeys.publicKey,
            encryptedToken: "",
            directUrl: old,
          }),
        ],
        account: { getPrincipalId: () => "user-1" },
        managerOptions: {
          webrtcTransport: transport,
          localTailscale: () => Effect.succeed(tailnet),
          directSessions: sessionStore(file.path),
        },
      });
      transport.emit("connected", HOST);
      await vi.waitFor(() => expect(fixture.server(HOST)).toBeDefined());
      await vi.waitFor(async () => expect(await keptToken(file?.path ?? "")).toBeNull());
    });
  });
});
