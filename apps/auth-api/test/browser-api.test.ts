import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { AuthServiceError } from "../src/server/auth-service";
import { type BrowserApiServices, browserSessionToken, handleBrowserApi } from "../src/server/browser-api";
import { sha256 } from "../src/server/crypto";
import { runApiEffect } from "../src/server/effect-runtime";
import { HostedSiteInputError } from "../src/server/hosted-site-contract";
import { RemoteControlPlaneError } from "../src/server/remote-control-plane";

const token = "a".repeat(43);
const user = { id: "account-one", email: "one@example.test", name: null, avatarUrl: null };
const logoVersion = "9b2f0c1e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const storedAvatars = new Set<string>();
const unusedBucketMethod = () => {
  throw new Error("Unused");
};
const avatars: R2Bucket = {
  async put(key) {
    storedAvatars.add(key);
    return {
      key,
      version: "1",
      size: PNG.byteLength,
      etag: "etag",
      httpEtag: '"etag"',
      checksums: { toJSON: () => ({}) },
      uploaded: new Date(),
      storageClass: "Standard",
      customMetadata: {},
      httpMetadata: { contentType: "image/png" },
      writeHttpMetadata() {},
    } satisfies R2Object;
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) storedAvatars.delete(key);
  },
  head: unusedBucketMethod,
  get: unusedBucketMethod,
  list: unusedBucketMethod,
  createMultipartUpload: unusedBucketMethod,
  resumeMultipartUpload: unusedBucketMethod,
};
function setup() {
  const billing = {
    getState: vi.fn(),
    createPortal: vi.fn().mockReturnValue(Effect.succeed("https://billing.stripe.com/p/session/portal")),
  };
  const services: BrowserApiServices = {
    auth: {
      startEmailSignIn: vi
        .fn()
        .mockReturnValue(Effect.succeed({ challengeId: "challenge", expiresAt: 100, resendAt: 50 })),
      verifyEmailCode: vi.fn().mockReturnValue(Effect.succeed({ sessionToken: token, user })),
      authenticate: vi.fn().mockReturnValue(Effect.succeed(user)),
      enforceTeamInviteRateLimit: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      updateName: vi.fn().mockReturnValue(Effect.succeed({ ...user, name: "One" })),
      updateAvatar: vi.fn().mockImplementation((_token, avatarUrl) => Effect.succeed({ ...user, avatarUrl })),
      listAccountSessions: vi.fn().mockReturnValue(Effect.succeed([])),
      revokeAccountSession: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    },
    avatarBucket: () => avatars,
    hostedSites: () => ({ list: vi.fn(), delete: vi.fn() }),
    remote: {
      removeOwnedHost: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      listHosts: vi.fn().mockReturnValue(Effect.succeed([])),
      startSession: vi.fn().mockReturnValue(Effect.succeed({ sessionId: "session", hostId: "host", expiresAt: 100 })),
      issueSessionTicket: vi.fn().mockReturnValue(Effect.succeed({ ticket: "short-ticket" })),
      endSession: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      endAccountSession: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      previewInvite: vi.fn(),
      acceptInvite: vi.fn(),
      listMembers: vi.fn().mockReturnValue(Effect.succeed([])),
      listInvites: vi.fn().mockReturnValue(Effect.succeed([])),
      createInvite: vi.fn().mockReturnValue(Effect.succeed({ inviteId: "invite", token: "invite-token" })),
      revokeInvite: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      changeMembership: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      hostAsset: vi.fn().mockReturnValue(Effect.succeed({ logoKey: logoVersion })),
    },
    hostLogo: vi
      .fn()
      .mockReturnValue(Effect.succeed(new Response("logo", { headers: { "Content-Type": "image/png" } }))),
    billing: () => billing,
    hosting: () => ({
      lifecycle: vi.fn(),
      list: vi.fn(),
      plans: vi.fn(),
      create: vi.fn(),
      checkout: vi.fn(),
      delete: vi.fn(),
      status: vi.fn(),
      wake: vi.fn(),
    }),
    inviteEmailDelivery: () => ({ send: vi.fn().mockReturnValue(Effect.succeed(undefined)) }),
    signalUrl: () => "wss://signal.example.test",
    sourceIp: () => "127.0.0.1",
    errorResponse: (error) =>
      Response.json(
        { error: "failed" },
        {
          status: error instanceof AuthServiceError || error instanceof RemoteControlPlaneError ? error.status : 500,
          headers: { "Cache-Control": "no-store" },
        },
      ),
  };
  return Object.assign(services, { billingService: billing });
}
function request(
  path: string,
  options: { method?: string; body?: object | undefined; cookie?: string; origin?: string; csrf?: string } = {},
) {
  const method = options.method ?? (options.body ? "POST" : "GET");
  return new Request(`https://openbot.test/api/browser/${path}`, {
    method,
    headers: {
      ...(method !== "GET"
        ? {
            "Content-Type": "application/json",
            Origin: options.origin ?? "https://openbot.test",
            "X-OpenBot-Browser": options.csrf ?? "1",
          }
        : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}
describe("browser account boundary", () => {
  it("keeps the credential in a protected cookie, never the response body", async () => {
    const response = await handleBrowserApi(
      request("email/verify", { body: { challengeId: "challenge", code: "123456" } }),
      setup(),
    );
    expect(await response.json()).toEqual({ user });
    expect(response.headers.get("Set-Cookie")).toBe(
      `__Host-openbot-web=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=34560000`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["https://attacker.test", "null", "https://other.openbot.test"])(
    "rejects mutation from %s before calling a service",
    async (origin) => {
      const services = setup();
      const response = await handleBrowserApi(
        request("email/start", { body: { email: user.email }, origin }),
        services,
      );
      expect(response.status).toBe(403);
      expect(services.auth.startEmailSignIn).not.toHaveBeenCalled();
    },
  );
  it("rejects missing CSRF header and ambiguous cookies", async () => {
    const response = await handleBrowserApi(request("email/start", { body: { email: user.email }, csrf: "" }), setup());
    expect(response.status).toBe(403);
    expect(
      browserSessionToken(request("session", { cookie: `__Host-openbot-web=${token}; __Host-openbot-web=${token}` })),
    ).toBeNull();
  });
  it("requires cookie authentication and refuses revoked sessions", async () => {
    const services = setup();
    expect((await handleBrowserApi(request("session"), services)).status).toBe(401);
    vi.mocked(services.auth.authenticate).mockReturnValue(Effect.succeed(null));
    expect(
      (await handleBrowserApi(request("session", { cookie: `__Host-openbot-web=${token}` }), services)).status,
    ).toBe(401);
  });
  it("binds remote sessions to the browser credential and revokes them on logout", async () => {
    const services = setup();
    const cookie = `__Host-openbot-web=${token}`;
    await handleBrowserApi(request("v2/remote/sessions/", { cookie, body: { hostId: "host" } }), services);
    expect(services.remote.startSession).toHaveBeenCalledWith(user.id, "host", await runApiEffect(sha256(token)));
    await handleBrowserApi(
      request("v2/remote/sessions/session/ticket", { cookie, body: { clientPublicKey: "client-key" } }),
      services,
    );
    expect(services.remote.issueSessionTicket).toHaveBeenCalledWith(
      user.id,
      "session",
      "client-key",
      await runApiEffect(sha256(token)),
    );
    await handleBrowserApi(request("v2/remote/sessions/session/end", { cookie, body: {} }), services);
    expect(services.remote.endSession).toHaveBeenCalledWith(user.id, "session", await runApiEffect(sha256(token)));
    const response = await handleBrowserApi(request("logout", { cookie, body: {} }), services);
    expect(services.remote.endAccountSession).toHaveBeenCalledWith(user.id, await runApiEffect(sha256(token)));
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
  it("does not proxy arbitrary account or host operations", async () => {
    const services = setup();
    const response = await handleBrowserApi(
      request("v1/agents", { cookie: `__Host-openbot-web=${token}`, body: { text: "private" } }),
      services,
    );
    expect(response.status).toBe(404);
  });
  it.each([400, 410, 429])("preserves email verification failure %s without setting a cookie", async (status) => {
    const services = setup();
    vi.mocked(services.auth.verifyEmailCode).mockReturnValue(
      Effect.fail(new AuthServiceError(status, "invalid_code", "Invalid code.")),
    );
    const response = await handleBrowserApi(
      request("email/verify", { body: { challengeId: "x", code: "wrong" } }),
      services,
    );
    expect(response.status).toBe(status);
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
  describe("host members and invites", () => {
    const cookie = `__Host-openbot-web=${token}`;
    it.each([
      ["PATCH", "v2/remote/hosts/host/members/membership", { role: "admin" }],
      ["DELETE", "v2/remote/hosts/host/members/membership", undefined],
      ["DELETE", "v2/remote/invites/invite", undefined],
      ["DELETE", "v2/remote/hosts/host", undefined],
      ["POST", "v2/remote/hosts/host/invites", { role: "member" }],
    ])("refuses a cross-origin %s %s before calling a service", async (method, path, body) => {
      const services = setup();
      for (const refused of [{ origin: "https://attacker.test" }, { csrf: "" }]) {
        const response = await handleBrowserApi(request(path, { method, body, cookie, ...refused }), services);
        expect(response.status).toBe(403);
      }
      expect(services.remote.changeMembership).not.toHaveBeenCalled();
      expect(services.remote.revokeInvite).not.toHaveBeenCalled();
      expect(services.remote.removeOwnedHost).not.toHaveBeenCalled();
      expect(services.remote.createInvite).not.toHaveBeenCalled();
    });
    it("removes an owned host through the authenticated account service", async () => {
      const services = setup();
      const response = await handleBrowserApi(
        request("v2/remote/hosts/host%2Fone", { method: "DELETE", cookie }),
        services,
      );
      expect(response.status).toBe(204);
      expect(services.remote.removeOwnedHost).toHaveBeenCalledWith(user.id, "host/one");
      const unauthorized = await handleBrowserApi(request("v2/remote/hosts/host", { method: "DELETE" }), services);
      expect(unauthorized.status).toBe(401);
      expect(services.remote.removeOwnedHost).toHaveBeenCalledTimes(1);
    });
    it("requires the browser cookie", async () => {
      const services = setup();
      const response = await handleBrowserApi(request("v2/remote/hosts/host/members/"), services);
      expect(response.status).toBe(401);
      expect(services.remote.listMembers).not.toHaveBeenCalled();
    });
    it("lets an admin read and change members and invites through the control plane", async () => {
      const services = setup();
      const members = await handleBrowserApi(request("v2/remote/hosts/host%2Fone/members/", { cookie }), services);
      expect(await members.json()).toEqual({ members: [] });
      expect(services.remote.listMembers).toHaveBeenCalledWith(user.id, "host/one");
      await handleBrowserApi(request("v2/remote/hosts/host/invites", { cookie }), services);
      expect(services.remote.listInvites).toHaveBeenCalledWith(user.id, "host");
      const created = await handleBrowserApi(
        request("v2/remote/hosts/host/invites", { cookie, body: { role: "member", email: "two@example.test" } }),
        services,
      );
      expect(created.status).toBe(201);
      expect(services.remote.createInvite).toHaveBeenCalledWith(user, {
        hostId: "host",
        role: "member",
        email: "two@example.test",
        expiresInSeconds: undefined,
        permanent: undefined,
      });
      const patched = await handleBrowserApi(
        request("v2/remote/hosts/host/members/membership", { method: "PATCH", cookie, body: { role: "admin" } }),
        services,
      );
      expect(patched.status).toBe(204);
      expect(services.remote.changeMembership).toHaveBeenCalledWith(user.id, {
        hostId: "host",
        membershipId: "membership",
        role: "admin",
        reactivate: false,
      });
      await handleBrowserApi(
        request("v2/remote/hosts/host/members/membership", { method: "DELETE", cookie }),
        services,
      );
      expect(services.remote.changeMembership).toHaveBeenLastCalledWith(user.id, {
        hostId: "host",
        membershipId: "membership",
        revoke: true,
      });
      await handleBrowserApi(request("v2/remote/invites/invite", { method: "DELETE", cookie }), services);
      expect(services.remote.revokeInvite).toHaveBeenCalledWith(user.id, "invite");
    });
    it("keeps the control plane refusal for a member", async () => {
      const services = setup();
      vi.mocked(services.remote.changeMembership).mockReturnValue(
        Effect.fail(new RemoteControlPlaneError(403, "remote_forbidden", "Only an owner or admin can do this.")),
      );
      const response = await handleBrowserApi(
        request("v2/remote/hosts/host/members/membership", { method: "DELETE", cookie }),
        services,
      );
      expect(response.status).toBe(403);
    });
    it.each([
      ["PATCH", "v2/remote/hosts/host/members/membership", { role: "owner" }],
      ["PATCH", "v2/remote/hosts/host/members/membership", { role: "member", reactivate: false }],
      ["POST", "v2/remote/hosts/host/invites", { role: "owner" }],
      ["POST", "v2/remote/hosts/host/invites", { role: "member", permanent: "yes" }],
    ])("refuses an invalid %s %s", async (method, path, body) => {
      const services = setup();
      const response = await handleBrowserApi(request(path, { method, cookie, body }), services);
      expect(response.status).toBe(400);
      expect(services.remote.changeMembership).not.toHaveBeenCalled();
      expect(services.remote.createInvite).not.toHaveBeenCalled();
    });
    it("sends an invitation email only for a canonical invite link", async () => {
      const services = setup();
      const send = vi.fn().mockReturnValue(Effect.succeed(undefined));
      services.inviteEmailDelivery = () => ({ send });
      const refused = await handleBrowserApi(
        request("v1/team-invitations/email", {
          cookie,
          body: {
            email: "two@example.test",
            serverName: "Studio",
            inviteUrl: "https://attacker.test/x",
            role: "member",
          },
        }),
        services,
      );
      expect(refused.status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });
  });
  describe("host logo", () => {
    const cookie = `__Host-openbot-web=${token}`;
    const path = `v2/remote/hosts/host%2Fone/logo?v=${logoVersion}`;
    it("requires the browser cookie before reading membership or storage", async () => {
      const services = setup();
      expect((await handleBrowserApi(request(path), services)).status).toBe(401);
      expect(services.remote.hostAsset).not.toHaveBeenCalled();
      expect(services.hostLogo).not.toHaveBeenCalled();
    });
    it("refuses a cross-site read", async () => {
      const services = setup();
      const response = await handleBrowserApi(
        new Request(`https://openbot.test/api/browser/${path}`, {
          headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
        }),
        services,
      );
      expect(response.status).toBe(403);
      expect(services.hostLogo).not.toHaveBeenCalled();
    });
    it("gives a member the current logo", async () => {
      const services = setup();
      const response = await handleBrowserApi(request(path, { cookie }), services);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("logo");
      expect(services.remote.hostAsset).toHaveBeenCalledWith(user.id, "host/one");
      expect(services.hostLogo).toHaveBeenCalledWith("host/one", logoVersion);
    });
    it("keeps the control plane refusal for a reader who is not a member", async () => {
      const services = setup();
      vi.mocked(services.remote.hostAsset).mockReturnValue(
        Effect.fail(new RemoteControlPlaneError(403, "remote_forbidden", "You are not a member of this host.")),
      );
      expect((await handleBrowserApi(request(path, { cookie }), services)).status).toBe(403);
      expect(services.hostLogo).not.toHaveBeenCalled();
    });
    it("does not read storage for an old or missing version", async () => {
      const services = setup();
      for (const stale of ["v2/remote/hosts/host/logo?v=old", "v2/remote/hosts/host/logo"]) {
        expect((await handleBrowserApi(request(stale, { cookie }), services)).status).toBe(404);
      }
      expect(services.hostLogo).not.toHaveBeenCalled();
    });
  });
  describe("account profile, avatar and sessions", () => {
    const cookie = `__Host-openbot-web=${token}`;
    const sessionId = "9b2f7c1e-8d4a-4b3c-9e2f-1a2b3c4d5e6f";
    function avatarUpload(options: { contentType?: string; origin?: string; csrf?: string; cookie?: string } = {}) {
      return new Request("https://openbot.test/api/browser/v1/me/avatar", {
        method: "PUT",
        headers: {
          "Content-Type": options.contentType ?? "image/png",
          Origin: options.origin ?? "https://openbot.test",
          "X-OpenBot-Browser": options.csrf ?? "1",
          ...(options.cookie === undefined ? { Cookie: cookie } : options.cookie ? { Cookie: options.cookie } : {}),
        },
        body: PNG,
      });
    }
    const operations: [string, string, object | undefined][] = [
      ["PATCH", "v1/me/profile", { name: "One" }],
      ["DELETE", "v1/me/avatar", undefined],
      ["DELETE", `v1/me/sessions/${sessionId}`, undefined],
    ];
    it.each(operations)("%s %s requires the browser cookie", async (method, path, body) => {
      const services = setup();
      expect((await handleBrowserApi(request(path, { method, body }), services)).status).toBe(401);
      expect((await handleBrowserApi(request("v1/me/sessions"), services)).status).toBe(401);
      expect((await handleBrowserApi(avatarUpload({ cookie: "" }), services)).status).toBe(401);
      expect(services.auth.updateName).not.toHaveBeenCalled();
      expect(services.auth.updateAvatar).not.toHaveBeenCalled();
      expect(services.auth.listAccountSessions).not.toHaveBeenCalled();
      expect(services.auth.revokeAccountSession).not.toHaveBeenCalled();
    });
    it.each(operations)("%s %s refuses a foreign origin or a missing CSRF header", async (method, path, body) => {
      const services = setup();
      for (const refused of [
        request(path, { method, body, cookie, origin: "https://attacker.test" }),
        request(path, { method, body, cookie, csrf: "" }),
        avatarUpload({ origin: "https://attacker.test" }),
        avatarUpload({ csrf: "" }),
      ]) {
        expect((await handleBrowserApi(refused, services)).status).toBe(403);
      }
      expect(services.auth.updateName).not.toHaveBeenCalled();
      expect(services.auth.updateAvatar).not.toHaveBeenCalled();
      expect(services.auth.revokeAccountSession).not.toHaveBeenCalled();
    });
    it("accepts image bytes only for the avatar upload", async () => {
      const services = setup();
      expect((await handleBrowserApi(avatarUpload({ contentType: "text/plain" }), services)).status).toBe(403);
      expect((await handleBrowserApi(avatarUpload({ contentType: "application/json" }), services)).status).toBe(403);
      const profileAsImage = new Request("https://openbot.test/api/browser/v1/me/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "image/png",
          Origin: "https://openbot.test",
          "X-OpenBot-Browser": "1",
          Cookie: cookie,
        },
        body: PNG,
      });
      expect((await handleBrowserApi(profileAsImage, services)).status).toBe(403);
      expect(services.auth.updateAvatar).not.toHaveBeenCalled();
      expect(services.auth.updateName).not.toHaveBeenCalled();
    });
    it("acts on the account of the browser cookie", async () => {
      const services = setup();
      const renamed = await handleBrowserApi(
        request("v1/me/profile", { method: "PATCH", body: { name: "One" }, cookie }),
        services,
      );
      expect(await renamed.json()).toMatchObject({ name: "One" });
      expect(services.auth.updateName).toHaveBeenCalledWith(token, "One");

      // Avatar object keys take a UUID account ID.
      const accountId = "4c7e2a91-3b5d-4f8e-a1c2-6d9e0f1a2b3c";
      vi.mocked(services.auth.authenticate).mockReturnValue(Effect.succeed({ ...user, id: accountId }));
      const uploaded = await handleBrowserApi(avatarUpload(), services);
      expect(uploaded.status).toBe(200);
      expect(services.auth.updateAvatar).toHaveBeenCalledWith(
        token,
        expect.stringMatching(new RegExp(`^/v1/avatars/${accountId}\\?v=`, "u")),
        null,
      );
      expect(storedAvatars.size).toBe(1);

      const listed = await handleBrowserApi(request("v1/me/sessions", { cookie }), services);
      expect(await listed.json()).toEqual({ sessions: [] });
      expect(services.auth.listAccountSessions).toHaveBeenCalledWith(token);

      const revoked = await handleBrowserApi(
        request(`v1/me/sessions/${sessionId}`, { method: "DELETE", cookie }),
        services,
      );
      expect(revoked.status).toBe(204);
      expect(services.auth.revokeAccountSession).toHaveBeenCalledWith(token, sessionId);
    });
  });
  it("validates and protects hosted server lifecycle mutations", async () => {
    const services = setup();
    const lifecycle = vi.fn().mockReturnValue(Effect.void);
    const hosting = services.hosting();
    services.hosting = () => ({ ...hosting, lifecycle });
    const path = "v2/hosting/servers/server-one/lifecycle";
    const cookie = `__Host-openbot-web=${token}`;
    const body = { action: "delete", timing: "period-end", confirmName: "One" };
    expect((await handleBrowserApi(request(path, { body }), services)).status).toBe(401);
    expect(
      (await handleBrowserApi(request(path, { body, cookie, origin: "https://attacker.test" }), services)).status,
    ).toBe(403);
    expect((await handleBrowserApi(request(path, { body: { action: "delete" }, cookie }), services)).status).toBe(400);
    expect(lifecycle).not.toHaveBeenCalled();
    expect(
      (await handleBrowserApi(request(path, { body: { ...body, serverId: "other" }, cookie }), services)).status,
    ).toBe(204);
    expect(lifecycle).toHaveBeenCalledWith(user, "server-one", { ...body, serverId: "server-one" });
  });

  describe("billing", () => {
    const cookie = `__Host-openbot-web=${token}`;
    const cancel = { flow: "cancel", subscriptionId: "sub_1" };

    it("refuses a cross-origin Portal request before it calls Stripe", async () => {
      const services = setup();
      for (const refused of [{ origin: "https://attacker.test" }, { csrf: "" }]) {
        const response = await handleBrowserApi(
          request("v1/me/billing/portal", { body: cancel, cookie, ...refused }),
          services,
        );
        expect(response.status).toBe(403);
      }
      expect(services.billingService.createPortal).not.toHaveBeenCalled();
    });

    it("sends Stripe back to the web client, refuses a bad flow, and answers 503 without a Stripe key", async () => {
      const services = setup();
      const opened = await handleBrowserApi(
        request("v1/me/billing/portal", { body: { ...cancel, extra: "x" }, cookie }),
        services,
      );
      expect(await opened.json()).toEqual({ url: "https://billing.stripe.com/p/session/portal" });
      expect(services.billingService.createPortal).toHaveBeenCalledWith(user.id, cancel, "web", "https://openbot.test");
      const invalid = await handleBrowserApi(
        request("v1/me/billing/portal", { body: { flow: "update", subscriptionId: "cus_1" }, cookie }),
        services,
      );
      expect(invalid.status).toBe(400);

      services.billing = () => null;
      const state = await handleBrowserApi(request("v1/me/billing", { cookie }), services);
      expect(await state.json()).toMatchObject({ available: false });
      const refused = await handleBrowserApi(
        request("v1/me/billing/portal", { body: { flow: "manage" }, cookie }),
        services,
      );
      expect(refused.status).toBe(503);
    });
  });
  describe("hosted sites", () => {
    const cookie = `__Host-openbot-web=${token}`;
    const idempotencyKey = "web:delete:4c7e2a91-3b5d-4f8e-a1c2-6d9e0f1a2b3c";
    function deleteSite(options: { cookie?: string; origin?: string; csrf?: string; key?: string } = {}) {
      return new Request("https://openbot.test/api/browser/v1/sites/site-one", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Origin: options.origin ?? "https://openbot.test",
          "X-OpenBot-Browser": options.csrf ?? "1",
          "Idempotency-Key": options.key ?? idempotencyKey,
          ...(options.cookie === undefined ? { Cookie: cookie } : options.cookie ? { Cookie: options.cookie } : {}),
        },
        body: "{}",
      });
    }
    function withSites() {
      const services = setup();
      const hostedSites = {
        list: vi.fn().mockReturnValue(Effect.succeed({ sites: [], limit: 1, used: 0 })),
        delete: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      };
      services.hostedSites = () => hostedSites;
      return { services, hostedSites };
    }
    it("removes an owned host through the authenticated account service", async () => {
      const services = setup();
      const response = await handleBrowserApi(
        request("v2/remote/hosts/host%2Fone", { method: "DELETE", cookie }),
        services,
      );
      expect(response.status).toBe(204);
      expect(services.remote.removeOwnedHost).toHaveBeenCalledWith(user.id, "host/one");
      const unauthorized = await handleBrowserApi(request("v2/remote/hosts/host", { method: "DELETE" }), services);
      expect(unauthorized.status).toBe(401);
      expect(services.remote.removeOwnedHost).toHaveBeenCalledTimes(1);
    });
    it("requires the browser cookie", async () => {
      const { services, hostedSites } = withSites();
      expect((await handleBrowserApi(request("v1/sites"), services)).status).toBe(401);
      expect((await handleBrowserApi(deleteSite({ cookie: "" }), services)).status).toBe(401);
      expect(hostedSites.list).not.toHaveBeenCalled();
      expect(hostedSites.delete).not.toHaveBeenCalled();
    });
    it("refuses a foreign origin or a missing CSRF header", async () => {
      const { services, hostedSites } = withSites();
      for (const refused of [deleteSite({ origin: "https://attacker.test" }), deleteSite({ csrf: "" })]) {
        expect((await handleBrowserApi(refused, services)).status).toBe(403);
      }
      expect(hostedSites.delete).not.toHaveBeenCalled();
    });
    it("acts on the sites of the browser cookie's account", async () => {
      const { services, hostedSites } = withSites();
      const listed = await handleBrowserApi(request("v1/sites", { cookie }), services);
      expect(await listed.json()).toEqual({ sites: [], limit: 1, used: 0 });
      expect(hostedSites.list).toHaveBeenCalledWith({ kind: "account", userId: user.id });

      const deleted = await handleBrowserApi(deleteSite(), services);
      expect(await deleted.json()).toEqual({ deleted: true });
      expect(hostedSites.delete).toHaveBeenCalledWith({ kind: "account", userId: user.id }, "site-one", idempotencyKey);
    });
    it("returns a hosted-site refusal with its own status", async () => {
      const { services, hostedSites } = withSites();
      const invalidKey = await handleBrowserApi(deleteSite({ key: "short" }), services);
      expect(invalidKey.status).toBe(400);
      expect(await invalidKey.json()).toMatchObject({ error: { code: "invalid_idempotency_key" } });
      expect(hostedSites.delete).not.toHaveBeenCalled();

      hostedSites.delete.mockReturnValue(
        Effect.fail(new HostedSiteInputError(409, "site_not_found", "The site was not found.")),
      );
      const missing = await handleBrowserApi(deleteSite(), services);
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ error: { code: "site_not_found" } });
    });
  });
});
