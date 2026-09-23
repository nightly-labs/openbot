import { describe, expect, it, vi } from "vitest";
import { AuthServiceError } from "../src/server/auth-service";
import { type BrowserApiServices, browserSessionToken, handleBrowserApi } from "../src/server/browser-api";
import { sha256 } from "../src/server/crypto";

const token = "a".repeat(43);
const user = { id: "account-one", email: "one@example.test", name: null, avatarUrl: null };
function setup() {
  const services: BrowserApiServices = {
    auth: {
      startEmailSignIn: vi.fn().mockResolvedValue({ challengeId: "challenge", expiresAt: 100, resendAt: 50 }),
      verifyEmailCode: vi.fn().mockResolvedValue({ sessionToken: token, user }),
      authenticate: vi.fn().mockResolvedValue(user),
    },
    remote: {
      listHosts: vi.fn().mockResolvedValue([]),
      startSession: vi.fn().mockResolvedValue({ sessionId: "session", hostId: "host", expiresAt: 100 }),
      issueSessionTicket: vi.fn().mockResolvedValue({ ticket: "short-ticket" }),
      endSession: vi.fn().mockResolvedValue(undefined),
      endAccountSession: vi.fn().mockResolvedValue(undefined),
      previewInvite: vi.fn(),
      acceptInvite: vi.fn(),
    },
    signalUrl: () => "wss://signal.example.test",
    sourceIp: () => "127.0.0.1",
    errorResponse: (error) =>
      Response.json(
        { error: "failed" },
        { status: error instanceof AuthServiceError ? error.status : 500, headers: { "Cache-Control": "no-store" } },
      ),
  };
  return services;
}
function request(path: string, options: { body?: object; cookie?: string; origin?: string; csrf?: string } = {}) {
  return new Request(`https://openbot.test/api/browser/${path}`, {
    method: options.body ? "POST" : "GET",
    headers: {
      ...(options.body
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
});
