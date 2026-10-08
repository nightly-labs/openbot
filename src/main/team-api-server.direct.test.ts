import { request as httpRequest } from "node:http";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  DIRECT_ENDPOINT_CAPABILITY,
  DIRECT_ENDPOINT_ROUTES,
} from "@openbot/contracts/team-protocol/direct-endpoint-v1";
import { HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { TEAM_CAPABILITIES_HEADER } from "@openbot/contracts/team-protocol/v1";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
// @vitest-environment node

// The direct Tailscale listener: `TeamApiServer.startDirectListener`. `tailscale serve` forwards the
// tailnet address to it, so it answers fewer routes than the main listener and only direct sessions.

import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamApiDirectEndpoint } from "./team-api/dependencies";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";
import { DIRECT_SESSION_TTL_MS } from "./team-store";

afterEach(stopTeamApiFixtures);

const DIRECT_URL = "https://studio-mac.tail4b2c1.ts.net";
const ALICE = { id: "alice-account", email: "alice@example.com", name: "Alice", avatarUrl: null };

async function directFixture(directEndpoint: TeamApiDirectEndpoint | null = { url: () => DIRECT_URL }) {
  const fixture = await createTeamApiFixture("direct");
  const { store } = fixture;
  await Effect.runPromise(
    store.configureWithAccount("Studio Mac", {
      id: "owner-account",
      email: "owner@example.com",
      name: "Owner",
      avatarUrl: null,
    }),
  );
  const invite = await Effect.runPromise(store.createInvite("member", ALICE.email));
  const joined = await Effect.runPromise(store.acceptInviteWithAccount(invite.token, ALICE));
  const started = await fixture.start({
    redeemCentralTicket: (ticket, serverId) =>
      Effect.sync(() => (ticket === "alice-ticket" && serverId === store.getIdentity()?.serverId ? ALICE : null)),
    ...(directEndpoint ? { directEndpoint } : {}),
  });
  const directPort = await runCauseEffect(started.api.startDirectListener());
  return {
    ...fixture,
    ...started,
    direct: `http://127.0.0.1:${directPort}`,
    mainToken: joined.sessionToken,
    aliceId: joined.member.id,
  };
}

async function post(base: string, path: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function get(base: string, path: string, token?: string) {
  return fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function directSignIn(base: string): Promise<{ sessionToken: string; sessionExpiresAt: string }> {
  const response = await post(base, TEAM_API_ROUTES.auth.account, { accountTicket: "alice-ticket" });
  expect(response.status).toBe(200);
  return response.json();
}

/** The status a WebSocket upgrade gets: 101 when it is accepted. */
function upgradeStatus(base: string, token: string): Promise<number> {
  const url = new URL(TEAM_API_ROUTES.events, base);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString("base64"),
        "Sec-WebSocket-Protocol": `openbot-events, openbot-token.${token}`,
      },
    });
    request.on("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    request.on("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", (error) => {
      // The host writes the status and closes the socket.
      if ("code" in error && error.code === "ECONNRESET") resolve(401);
      else reject(error);
    });
    request.end();
  });
}

describe("TeamApiServer direct Tailscale listener", () => {
  it("answers identity and compatibility, and signs a member in only with an account ticket", async () => {
    const { direct, store } = await directFixture();
    const identity = await get(direct, `${TEAM_API_ROUTES.identity}?challenge=${"c".repeat(32)}`);
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({ serverId: store.getIdentity()?.serverId, challenge: "c".repeat(32) });
    expect((await get(direct, TEAM_API_ROUTES.compatibility)).status).toBe(200);

    // No password, invitation or join route on the tailnet address.
    expect(
      (await post(direct, TEAM_API_ROUTES.auth.login, { username: "owner", password: "x".repeat(12) })).status,
    ).toBe(401);
    expect((await post(direct, TEAM_API_ROUTES.join.invitationPreview, { inviteToken: "a".repeat(43) })).status).toBe(
      401,
    );
    expect(
      (await post(direct, TEAM_API_ROUTES.join.account, { inviteToken: "a".repeat(43), accountTicket: "alice-ticket" }))
        .status,
    ).toBe(401);
    expect((await post(direct, TEAM_API_ROUTES.auth.account, { accountTicket: "wrong" })).status).toBe(401);

    const before = Date.now();
    const session = await directSignIn(direct);
    const expiresAt = Date.parse(session.sessionExpiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + DIRECT_SESSION_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + DIRECT_SESSION_TTL_MS);
    expect(DIRECT_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1_000);
    expect(store.listSessions().some((entry) => entry.expiresAt === session.sessionExpiresAt)).toBe(true);
  });

  it("keeps direct sessions and other sessions on their own listener", async () => {
    const { direct, base, mainToken } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    expect((await get(direct, TEAM_API_ROUTES.me, sessionToken)).status).toBe(200);
    expect((await get(base, TEAM_API_ROUTES.me, sessionToken)).status).toBe(401);
    expect((await get(direct, TEAM_API_ROUTES.me, mainToken)).status).toBe(401);
    expect((await get(base, TEAM_API_ROUTES.me, mainToken)).status).toBe(200);
    expect(await upgradeStatus(direct, sessionToken)).toBe(101);
    expect(await upgradeStatus(direct, mainToken)).toBe(401);
    expect(await upgradeStatus(base, sessionToken)).toBe(401);
  });

  it("accepts a direct session again from a new connection, as a client that restarted sends it", async () => {
    const { direct } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    expect(await upgradeStatus(direct, sessionToken)).toBe(101);
    // The client's sockets and its memory are gone; the host keeps the session until it ends.
    expect((await get(direct, TEAM_API_ROUTES.me, sessionToken)).status).toBe(200);
    expect(await upgradeStatus(direct, sessionToken)).toBe(101);
  });

  it("keeps the remote screen, the browser view and the Tailscale setup off the direct listener", async () => {
    const { direct } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    for (const path of [
      TEAM_API_ROUTES.remoteScreen.sessions,
      TEAM_API_ROUTES.remoteScreen.setup,
      TEAM_API_ROUTES.remoteScreen.viewer("session-1"),
      TEAM_API_ROUTES.browser.viewSessions,
    ]) {
      expect((await get(direct, path, sessionToken)).status, path).toBe(404);
    }
    // Turning the direct path off over the direct path would close the connection that asks. Without the
    // gate, this host would answer 400 (it has no Tailscale setup); with it, the path is unknown.
    for (const path of Object.values(HOST_TAILSCALE_ROUTES)) {
      const headers = { "OpenBot-Capabilities": "host-tailscale-v1" };
      expect((await post(direct, path, {}, sessionToken, headers)).status, path).toBe(404);
    }
  });

  it("ends a direct session as soon as the member is removed", async () => {
    const { direct, store, aliceId } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    expect((await get(direct, TEAM_API_ROUTES.me, sessionToken)).status).toBe(200);
    await Effect.runPromise(store.removeMember(aliceId));
    expect((await get(direct, TEAM_API_ROUTES.me, sessionToken)).status).toBe(401);
    expect((await post(direct, TEAM_API_ROUTES.auth.account, { accountTicket: "alice-ticket" })).status).toBe(400);
  });

  it("reads the member list before a direct sign-in and refuses when it cannot", async () => {
    const refreshMembers = vi.fn(() => Effect.fail(new RemoteWorkflowError({ cause: new Error("offline") })));
    const { direct } = await directFixture({ url: () => DIRECT_URL, refreshMembers });
    const response = await post(direct, TEAM_API_ROUTES.auth.account, { accountTicket: "alice-ticket" });
    expect(response.status).toBe(503);
    expect(refreshMembers).toHaveBeenCalledOnce();
  });

  it("tells a signed-in member the address only when it negotiated the capability", async () => {
    const { direct, base, mainToken } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    const headers = { [TEAM_CAPABILITIES_HEADER]: DIRECT_ENDPOINT_CAPABILITY };
    const answer = await post(base, DIRECT_ENDPOINT_ROUTES.read, {}, mainToken, headers);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ url: DIRECT_URL });
    expect((await post(direct, DIRECT_ENDPOINT_ROUTES.read, {}, sessionToken, headers)).status).toBe(200);
    expect((await post(base, DIRECT_ENDPOINT_ROUTES.read, {})).status).toBe(401);
  });

  it("advertises the capability only on a host that can offer it", async () => {
    const offered = await directFixture();
    const compatibility = await (await get(offered.base, TEAM_API_ROUTES.compatibility)).json();
    expect(compatibility.capabilities).toContain(DIRECT_ENDPOINT_CAPABILITY);
    const plain = await directFixture(null);
    const plainCompatibility = await (await get(plain.base, TEAM_API_ROUTES.compatibility)).json();
    expect(plainCompatibility.capabilities).not.toContain(DIRECT_ENDPOINT_CAPABILITY);
  });

  it("closes the listener and every direct session when the direct path stops", async () => {
    const { direct, api, store } = await directFixture();
    const { sessionToken } = await directSignIn(direct);
    await Effect.runPromise(api.stopDirectListener());
    expect(api.directPort).toBeNull();
    expect(store.authenticateDirectSession(sessionToken)).toBeNull();
    await expect(fetch(`${direct}${TEAM_API_ROUTES.me}`)).rejects.toThrow();
  });
});
