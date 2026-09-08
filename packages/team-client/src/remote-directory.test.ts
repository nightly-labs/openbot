import { createInviteUrl } from "@openbot/contracts/invite-links";
import { describe, expect, it, vi } from "vitest";

import {
  createRemoteDirectoryRefresh,
  type RemoteHostKeyStore,
  RemoteTeamDirectoryClient,
  watchRemoteDirectory,
} from "./remote-directory";

const API_URL = "https://api.openbot.run";
const HOST_ID = "11111111-1111-4111-8111-111111111111";
const HOST_KEY = "desktop-public-key";
const HOST_FINGERPRINT = "AqBeU6SSjNMMzQkof9ad85KzSTI7kiNWQtfzR-sbXsU";
const INVITE = createInviteUrl({
  apiUrl: `${API_URL}/`,
  serverId: HOST_ID,
  fingerprint: HOST_FINGERPRINT,
  token: "t".repeat(32),
});
const PREVIEW = {
  hostId: HOST_ID,
  hostName: "Studio",
  role: "member",
  expiresAt: 9_999_999_999_999,
  emailBound: false,
  devicePublicKey: HOST_KEY,
};
const ACCEPTED = { hostId: HOST_ID, membershipId: "membership-1", role: "member" };

describe("RemoteTeamDirectoryClient", () => {
  it("removes a revoked paired desktop while keeping the other memberships available", async () => {
    const remote = {
      hostId: "other",
      name: "Other",
      logoKey: null,
      devicePublicKey: "other-key",
      membershipId: "other-member",
      role: "member",
    };
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "session",
      pairedHost: { hostId: HOST_ID, fingerprint: HOST_FINGERPRINT },
      fetch: async () => Response.json({ hosts: [remote] }),
    });
    await expect(client.listHosts()).resolves.toEqual([remote]);
  });

  it("pins the QR's exact host even when another owned desktop is first", async () => {
    const pinned = new Map<string, string>();
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      pairedHost: { hostId: HOST_ID, fingerprint: HOST_FINGERPRINT },
      hostKeys: {
        get: async (id) => pinned.get(id) ?? null,
        set: async (id, key) => {
          pinned.set(id, key);
        },
      },
      fetch: async () =>
        Response.json({
          hosts: [
            {
              hostId: "other-desktop",
              name: "A Desktop",
              logoKey: null,
              devicePublicKey: "other-key",
              membershipId: "other-membership",
              role: "owner",
            },
            {
              hostId: HOST_ID,
              name: "Z Desktop",
              logoKey: null,
              devicePublicKey: HOST_KEY,
              membershipId: "paired-membership",
              role: "owner",
            },
          ],
        }),
    });
    await client.listHosts();
    expect(pinned.get(HOST_ID)).toBe(HOST_KEY);
    expect(pinned.has("other-desktop")).toBe(false);
  });

  it("rejects directory substitution of a scanned host key", async () => {
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      pairedHost: { hostId: HOST_ID, fingerprint: HOST_FINGERPRINT },
      fetch: async () =>
        Response.json({
          hosts: [
            {
              hostId: HOST_ID,
              name: "Desktop",
              logoKey: null,
              devicePublicKey: "substituted",
              membershipId: "paired-membership",
              role: "owner",
            },
          ],
        }),
    });
    await expect(client.listHosts()).rejects.toThrow("paired desktop identity");
  });

  it("leaves the exact membership without removing the trusted key", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (input, init) => {
        requests.push({ url: input.toString(), method: init?.method });
        return new Response(null, { status: 204 });
      },
    });
    await client.leaveHost(HOST_ID, "membership-1");
    expect(requests).toEqual([{ url: `${API_URL}/v2/remote/hosts/${HOST_ID}/members/membership-1`, method: "DELETE" }]);
  });
  it("returns only connectable hosts and authenticates the directory request", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (input, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get("Authorization"),
          url: input.toString(),
        });
        return Response.json({
          hosts: [
            {
              hostId: HOST_ID,
              name: "Studio",
              logoKey: null,
              devicePublicKey: "desktop-public-key",
              membershipId: "membership-1",
              role: "owner",
            },
            {
              hostId: "22222222-2222-4222-8222-222222222222",
              name: "Old host",
              logoKey: null,
              devicePublicKey: null,
              membershipId: "membership-2",
              role: "member",
            },
          ],
        });
      },
    });

    await expect(client.listHosts()).resolves.toEqual([
      {
        hostId: HOST_ID,
        name: "Studio",
        logoKey: null,
        devicePublicKey: "desktop-public-key",
        membershipId: "membership-1",
        role: "owner",
      },
    ]);
    expect(requests).toEqual([
      { authorization: "Bearer mobile-session", url: "https://api.openbot.run/v2/remote/hosts/" },
    ]);
  });

  it("ends the logical session when ticket creation fails", async () => {
    const paths: string[] = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (input) => {
        const path = new URL(input.toString()).pathname;
        paths.push(path);
        if (path === "/v2/remote/sessions/") {
          return Response.json(
            { sessionId: "session-1", hostId: HOST_ID, expiresAt: Date.now() + 60_000 },
            { status: 201 },
          );
        }
        if (path.endsWith("/ticket")) return Response.json({ error: "host offline" }, { status: 503 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.createBootstrap(HOST_ID, "client-public-key")).rejects.toThrow("host offline");
    expect(paths).toEqual([
      "/v2/remote/sessions/",
      "/v2/remote/sessions/session-1/ticket",
      "/v2/remote/sessions/session-1/end",
    ]);
  });

  it("accepts an unencrypted Signal URL only on a private development network", async () => {
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (input) => {
        const path = new URL(input.toString()).pathname;
        if (path === "/v2/remote/sessions/") {
          return Response.json(
            { sessionId: "session-1", hostId: HOST_ID, expiresAt: Date.now() + 60_000 },
            { status: 201 },
          );
        }
        return Response.json({
          signalUrl: "ws://192.168.1.143:3101/v1/signal",
          ticket: "remote-ticket",
          expiresAt: Date.now() + 60_000,
        });
      },
    });

    await expect(client.createBootstrap(HOST_ID, "client-public-key")).resolves.toMatchObject({
      signalUrl: "ws://192.168.1.143:3101/v1/signal",
    });
  });

  it("does not send the mobile session token while previewing a public invitation", async () => {
    const authorizations: Array<string | null> = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("Authorization"));
        return Response.json({
          hostId: HOST_ID,
          hostName: "Studio",
          role: "member",
          expiresAt: Date.now() + 60_000,
          emailBound: false,
          devicePublicKey: "desktop-public-key",
        });
      },
    });
    const inviteUrl = createInviteUrl({
      apiUrl: `${API_URL}/`,
      serverId: HOST_ID,
      fingerprint: HOST_FINGERPRINT,
      token: "t".repeat(32),
    });

    await expect(client.previewInvite(inviteUrl)).resolves.toMatchObject({ hostId: HOST_ID, hostName: "Studio" });
    expect(authorizations).toEqual([null]);
  });

  it.each([null, "substituted-key"])("does not consume an invite when its preview key is %s", async (key) => {
    const paths: string[] = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "session",
      fetch: async (input) => {
        paths.push(new URL(input.toString()).pathname);
        return Response.json(
          new URL(input.toString()).pathname.endsWith("/preview") ? { ...PREVIEW, devicePublicKey: key } : ACCEPTED,
        );
      },
    });
    await expect(client.acceptInvite(INVITE)).rejects.toThrow("fingerprint");
    expect(paths).toEqual(["/v2/remote/invites/preview"]);
  });

  it.each([
    { ...ACCEPTED, hostId: "another-host" },
    { ...ACCEPTED, membershipId: "" },
    { ...ACCEPTED, role: "admin" },
  ])("rejects an acceptance that does not match the reviewed invitation: %j", async (accepted) => {
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "session",
      fetch: async (input) =>
        Response.json(new URL(input.toString()).pathname.endsWith("/preview") ? PREVIEW : accepted),
    });
    await expect(client.acceptInvite(INVITE)).rejects.toThrow("invalid invitation acceptance");
  });

  it("returns the joined host without needing a directory refresh, and retains its pin across client restarts", async () => {
    const keys = new Map<string, string>();
    const hostKeys: RemoteHostKeyStore = {
      get: async (id) => keys.get(id) ?? null,
      set: async (id, key) => {
        keys.set(id, key);
      },
    };
    let advertisedKey = HOST_KEY;
    let directoryOffline = true;
    const options = {
      apiUrl: API_URL,
      token: "session",
      hostKeys,
      fetch: async (input: string | URL | Request) => {
        const path = new URL(input.toString()).pathname;
        if (path.endsWith("/preview")) return Response.json(PREVIEW);
        if (path.endsWith("/accept")) {
          expect(keys.get(HOST_ID)).toBe(HOST_KEY);
          return Response.json(ACCEPTED);
        }
        if (directoryOffline) throw new Error("Directory offline");
        return Response.json({
          hosts: [{ ...ACCEPTED, name: "Studio", logoKey: null, devicePublicKey: advertisedKey }],
        });
      },
    };
    const client = new RemoteTeamDirectoryClient(options);
    await expect(client.acceptInvite(INVITE)).resolves.toEqual({
      ...ACCEPTED,
      name: "Studio",
      logoKey: null,
      devicePublicKey: HOST_KEY,
    });
    await expect(client.listHosts()).rejects.toThrow("Directory offline");
    directoryOffline = false;
    await expect(client.listHosts()).resolves.toMatchObject([{ devicePublicKey: HOST_KEY }]);
    advertisedKey = "substituted-key";
    await expect(new RemoteTeamDirectoryClient(options).listHosts()).rejects.toThrow("server identity changed");
    expect(keys.get(HOST_ID)).toBe(HOST_KEY);
  });

  it("does not consume the invite if its pin cannot be stored or conflicts with an existing pin", async () => {
    for (const pinned of [null, "other-key"]) {
      const paths: string[] = [];
      const client = new RemoteTeamDirectoryClient({
        apiUrl: API_URL,
        token: "session",
        hostKeys: {
          get: async () => pinned,
          set: async () => {
            throw new Error("Keychain locked");
          },
        },
        fetch: async (input) => {
          paths.push(new URL(input.toString()).pathname);
          return Response.json(PREVIEW);
        },
      });
      await expect(client.acceptInvite(INVITE)).rejects.toThrow(pinned ? "conflicts" : "Keychain locked");
      expect(paths).toEqual(["/v2/remote/invites/preview"]);
    }
  });
});

describe("mobile member management", () => {
  it("uses the account API for member actions even while the desktop is offline", async () => {
    const requests: Array<{ path: string; method: string; body: string | null }> = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url.toString()).pathname,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(null, { status: 204 });
      },
    });
    await client.updateMember(HOST_ID, "member/id", "admin");
    await client.updateMember(HOST_ID, "member/id", "member", true);
    await client.leaveHost(HOST_ID, "member/id");
    await client.revokeInvite("invite/id");
    expect(requests).toEqual([
      { path: `/v2/remote/hosts/${HOST_ID}/members/member%2Fid`, method: "PATCH", body: '{"role":"admin"}' },
      {
        path: `/v2/remote/hosts/${HOST_ID}/members/member%2Fid`,
        method: "PATCH",
        body: '{"role":"member","reactivate":true}',
      },
      { path: `/v2/remote/hosts/${HOST_ID}/members/member%2Fid`, method: "DELETE", body: null },
      { path: "/v2/remote/invites/invite%2Fid", method: "DELETE", body: null },
    ]);
  });

  it("creates a shareable invitation bound to the selected host key", async () => {
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async () => Response.json({ inviteId: "invite-1", token: "t".repeat(32), expiresAt: 1234 }),
    });
    expect(await client.createInvite({ hostId: HOST_ID, devicePublicKey: HOST_KEY }, { role: "member" })).toEqual({
      inviteId: "invite-1",
      inviteUrl: INVITE,
      expiresAt: 1234,
    });
  });

  it("sends the created email invitation through the delivery endpoint", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (url, init) => {
        const path = new URL(url.toString()).pathname;
        requests.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        return path.endsWith("/email")
          ? new Response(null, { status: 204 })
          : Response.json({ inviteId: "invite-1", token: "t".repeat(32), expiresAt: 1234 });
      },
    });
    const invite = await client.sendInviteEmail(
      { hostId: HOST_ID, devicePublicKey: HOST_KEY, name: "My desktop" },
      { role: "member", email: "member@example.com" },
    );
    expect(requests).toEqual([
      { path: `/v2/remote/hosts/${HOST_ID}/invites`, body: { role: "member", email: "member@example.com" } },
      {
        path: "/v1/team-invitations/email",
        body: {
          role: "member",
          email: "member@example.com",
          serverName: "My desktop",
          inviteUrl: INVITE,
        },
      },
    ]);
    expect(invite.inviteUrl).toBe(INVITE);
  });

  it("revokes an undelivered invitation and reports the delivery failure", async () => {
    const revoked: string[] = [];
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (url, init) => {
        const path = new URL(url.toString()).pathname;
        if (init?.method === "DELETE") {
          revoked.push(path);
          return new Response(null, { status: 204 });
        }
        if (path.endsWith("/email")) return Response.json({ message: "Email delivery unavailable" }, { status: 503 });
        return Response.json({ inviteId: "invite-1", token: "t".repeat(32), expiresAt: 1234 });
      },
    });
    await expect(
      client.sendInviteEmail(
        { hostId: HOST_ID, devicePublicKey: HOST_KEY, name: "My desktop" },
        { role: "member", email: "member@example.com" },
      ),
    ).rejects.toThrow();
    expect(revoked).toEqual(["/v2/remote/invites/invite-1"]);
  });

  it("returns member and invitation data and preserves permission failures", async () => {
    const member = {
      membershipId: "member-1",
      email: "member@example.com",
      name: null,
      role: "member",
      status: "revoked",
    };
    const invite = { inviteId: "invite-1", email: null, role: "admin", expiresAt: 1234, usedAt: null, revokedAt: null };
    let denied = false;
    const client = new RemoteTeamDirectoryClient({
      apiUrl: API_URL,
      token: "mobile-session",
      fetch: async (url) =>
        denied
          ? Response.json({ error: "Owner access required." }, { status: 403 })
          : Response.json(url.toString().endsWith("members/") ? { members: [member] } : { invites: [invite] }),
    });
    const result = [await client.listMembers(HOST_ID), await client.listInvites(HOST_ID)];
    expect(result).toEqual([[member], [invite]]);
    denied = true;
    await expect(client.updateMember(HOST_ID, "member-1", "admin")).rejects.toMatchObject({ status: 403 });
  });
});

describe("directory refresh", () => {
  it("coalesces simultaneous requests and limits automatic refreshes, including failures", async () => {
    let now = 0;
    const load = vi.fn(async () => {
      throw new Error("Offline");
    });
    const refresh = createRemoteDirectoryRefresh(load, () => now);
    await Promise.allSettled([refresh.refresh(), refresh.refresh(), refresh.refresh(true)]);
    now = 29_999;
    await refresh.refresh().catch(() => undefined);
    now = 30_000;
    await refresh.refresh().catch(() => undefined);
    await refresh.refresh(true).catch(() => undefined);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

it("finds memberships accepted on another device and stops polling on cleanup", async () => {
  vi.useFakeTimers();
  let hosts: object[] = [];
  const client = new RemoteTeamDirectoryClient({
    apiUrl: API_URL,
    token: "mobile-session",
    fetch: async () => Response.json({ hosts }),
  });
  let visible: string[] = [];
  const refresh = createRemoteDirectoryRefresh(async () => {
    visible = (await client.listHosts()).map((host) => host.hostId);
  });
  const stop = watchRemoteDirectory(() => refresh.refresh(true));
  try {
    await refresh.refresh(true);
    hosts = [
      {
        hostId: HOST_ID,
        name: "Desktop",
        logoKey: null,
        devicePublicKey: HOST_KEY,
        membershipId: "membership-1",
        role: "member",
      },
    ];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visible).toEqual([HOST_ID]);
    stop();
    hosts = [];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(visible).toEqual([HOST_ID]);
  } finally {
    stop();
    vi.useRealTimers();
  }
});
