// @vitest-environment node

// The direct Tailscale path of a joined WebRTC server, through the manager: which transport a
// connection uses, and what reaches the direct address before the host key is checked.

import { generateKeyPairSync, sign } from "node:crypto";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import type { RemoteHostSummary } from "./central-auth-records";
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

/** The host at the direct address. `keys` signs the identity challenge. */
function directHost(keys: { publicKey: string; privateKey: string } = hostKeys) {
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
      [TEAM_API_ROUTES.auth.account]: () =>
        Response.json({
          member: {
            id: "membership-1",
            username: "person@example.com",
            email: "person@example.com",
            name: null,
            avatarUrl: null,
            role: "member",
            createdAt: "2026-10-01T00:00:00.000Z",
            disabled: false,
          },
          sessionToken: "direct-session-token",
          sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      [TEAM_API_ROUTES.remoteScreen.capabilities]: () => Response.json({ ready: false }),
    },
  });
}

async function directFixture(options: { directUrl?: string; localTailscale?: TailscaleLocalState } = {}) {
  const transport = fakeWebRtcTransport([listedHost()]);
  const connect = vi.spyOn(transport, "connect").mockReturnValue(Effect.void);
  const createTeamAuthTicket = vi.fn(() => Effect.succeed("account-ticket"));
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
    account: { createTeamAuthTicket },
    managerOptions: {
      webrtcTransport: transport,
      localTailscale: () => Effect.succeed(options.localTailscale ?? tailnet),
    },
  });
  return { ...fixture, connect, createTeamAuthTicket };
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
});
