import { describe, expect, it, vi } from "vitest";
import { AuthServiceError } from "../src/server/auth-service";
import { type BrowserApiServices, browserSessionToken, handleBrowserApi } from "../src/server/browser-api";
import { sha256 } from "../src/server/crypto";
import { RemoteControlPlaneError } from "../src/server/remote-control-plane";

const token = "a".repeat(43);
const user = { id: "account-one", email: "one@example.test", name: null, avatarUrl: null };
function setup() {
  const services: BrowserApiServices = {
    auth: {
      startEmailSignIn: vi.fn().mockResolvedValue({ challengeId: "challenge", expiresAt: 100, resendAt: 50 }),
      verifyEmailCode: vi.fn().mockResolvedValue({ sessionToken: token, user }),
      authenticate: vi.fn().mockResolvedValue(user),
      enforceTeamInviteRateLimit: vi.fn().mockResolvedValue(undefined),
    },
    remote: {
      listHosts: vi.fn().mockResolvedValue([]),
      startSession: vi.fn().mockResolvedValue({ sessionId: "session", hostId: "host", expiresAt: 100 }),
      issueSessionTicket: vi.fn().mockResolvedValue({ ticket: "short-ticket" }),
      endSession: vi.fn().mockResolvedValue(undefined),
      endAccountSession: vi.fn().mockResolvedValue(undefined),
      previewInvite: vi.fn(),
      acceptInvite: vi.fn(),
      listMembers: vi.fn().mockResolvedValue([]),
      listInvites: vi.fn().mockResolvedValue([]),
      createInvite: vi.fn().mockResolvedValue({ inviteId: "invite", token: "invite-token" }),
      revokeInvite: vi.fn().mockResolvedValue(undefined),
      changeMembership: vi.fn().mockResolvedValue(undefined),
    },
    inviteEmailDelivery: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
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
  return services;
}
function request(
  path: string,
  options: { method?: string; body?: object; cookie?: string; origin?: string; csrf?: string } = {},
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
    vi.mocked(services.auth.authenticate).mockResolvedValue(null);
    expect(
      (await handleBrowserApi(request("session", { cookie: `__Host-openbot-web=${token}` }), services)).status,
    ).toBe(401);
  });
  it("binds remote sessions to the browser credential and revokes them on logout", async () => {
    const services = setup();
    const cookie = `__Host-openbot-web=${token}`;
    await handleBrowserApi(request("v2/remote/sessions/", { cookie, body: { hostId: "host" } }), services);
    expect(services.remote.startSession).toHaveBeenCalledWith(user.id, "host", await sha256(token));
    await handleBrowserApi(
      request("v2/remote/sessions/session/ticket", { cookie, body: { clientPublicKey: "client-key" } }),
      services,
    );
    expect(services.remote.issueSessionTicket).toHaveBeenCalledWith(
      user.id,
      "session",
      "client-key",
      await sha256(token),
    );
    await handleBrowserApi(request("v2/remote/sessions/session/end", { cookie, body: {} }), services);
    expect(services.remote.endSession).toHaveBeenCalledWith(user.id, "session", await sha256(token));
    const response = await handleBrowserApi(request("logout", { cookie, body: {} }), services);
    expect(services.remote.endAccountSession).toHaveBeenCalledWith(user.id, await sha256(token));
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
    vi.mocked(services.auth.verifyEmailCode).mockRejectedValue(
      new AuthServiceError(status, "invalid_code", "Invalid code."),
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
      ["POST", "v2/remote/hosts/host/invites", { role: "member" }],
    ])("refuses a cross-origin %s %s before calling a service", async (method, path, body) => {
      const services = setup();
      for (const refused of [{ origin: "https://attacker.test" }, { csrf: "" }]) {
        const response = await handleBrowserApi(request(path, { method, body, cookie, ...refused }), services);
        expect(response.status).toBe(403);
      }
      expect(services.remote.changeMembership).not.toHaveBeenCalled();
      expect(services.remote.revokeInvite).not.toHaveBeenCalled();
      expect(services.remote.createInvite).not.toHaveBeenCalled();
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
      vi.mocked(services.remote.changeMembership).mockRejectedValue(
        new RemoteControlPlaneError(403, "remote_forbidden", "Only an owner or admin can do this."),
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
      const send = vi.fn().mockResolvedValue(undefined);
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
});
